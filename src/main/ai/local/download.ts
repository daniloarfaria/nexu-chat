import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Baixador genérico de arquivos grandes (motor da IA, modelos, e depois o whisper.cpp):
 * - grava em `<destino>.part` e continua de onde parou (cabeçalho Range) se a internet cair;
 * - confere o SHA-256 antes de colocar no lugar; arquivo diferente é apagado e recusado;
 * - só https (http só para testes no próprio computador).
 */

export interface DownloadOptions {
  url: string
  dest: string
  sha256: string
  /** tamanho esperado em bytes (opcional, protege contra arquivo maior que o previsto) */
  size?: number
  onProgress?: (received: number, total: number) => void
  signal?: AbortSignal
  /** tentativas seguidas quando a conexão cai (padrão 4) */
  retries?: number
  /** sem receber nada por este tempo, a conexão é refeita (padrão 60 s) */
  idleTimeoutMs?: number
  /** permite http em 127.0.0.1 (testes) */
  allowLocalHttp?: boolean
}

export class ChecksumError extends Error {
  constructor() {
    super('O arquivo baixado veio diferente do esperado e foi apagado. Tente de novo.')
  }
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256')
  await pipeline(createReadStream(path), h)
  return h.digest('hex')
}

/** Confere o arquivo; se o SHA-256 não bate, apaga e lança erro. */
export async function verifyOrDelete(path: string, sha256: string): Promise<void> {
  const got = await sha256File(path)
  if (got !== sha256.toLowerCase()) {
    rmSync(path, { force: true })
    throw new ChecksumError()
  }
}

/** Endereço recusado (também depois de redirecionamento): não adianta tentar de novo. */
export class UrlNotAllowedError extends Error {
  constructor() {
    super('Endereço de download não permitido')
  }
}

function checkUrl(raw: string, allowLocalHttp: boolean): void {
  const u = new URL(raw)
  if (u.username || u.password) throw new UrlNotAllowedError()
  if (u.protocol === 'https:') return
  if (allowLocalHttp && u.protocol === 'http:' && u.hostname === '127.0.0.1') return
  throw new UrlNotAllowedError()
}

const MAX_REDIRECTS = 5

/** Segue redirecionamentos um a um, conferindo cada endereço (GitHub e Hugging Face mandam para a CDN). */
async function fetchChecked(o: DownloadOptions, init: RequestInit): Promise<Response> {
  let url = o.url
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    checkUrl(url, !!o.allowLocalHttp)
    const res = await fetch(url, { ...init, redirect: 'manual' })
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel().catch(() => undefined)
      url = new URL(loc, url).toString()
      continue
    }
    return res
  }
  throw new Error('Redirecionamentos demais no download')
}

const sizeOf = (p: string): number => (existsSync(p) ? statSync(p).size : 0)

/** Uma tentativa: baixa (ou continua) o `.part`. */
async function fetchPart(o: DownloadOptions, part: string): Promise<void> {
  const start = sizeOf(part)
  const idle = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const bump = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => idle.abort(new Error('A conexão parou de responder')), o.idleTimeoutMs ?? 60_000)
  }
  const signal = o.signal ? AbortSignal.any([o.signal, idle.signal]) : idle.signal
  bump()
  try {
    const res = await fetchChecked(o, { headers: start ? { range: `bytes=${start}-` } : {}, signal })
    if (res.status === 416) {
      // o .part já tem tudo (ou está estragado): a conferência decide
      await res.body?.cancel().catch(() => undefined)
      return
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined)
      throw new Error(`O servidor respondeu ${res.status}`)
    }
    const resumed = res.status === 206 && start > 0
    const already = resumed ? start : 0
    const len = Number(res.headers.get('content-length')) || 0
    const total = o.size ?? (len ? already + len : 0)
    if (o.size && len && already + len > o.size) {
      await res.body.cancel().catch(() => undefined)
      rmSync(part, { force: true })
      throw new ChecksumError()
    }
    let received = already
    let tooBig = false
    o.onProgress?.(received, total)
    const body = Readable.fromWeb(res.body as never)
    try {
      await pipeline(
        body,
        async function* (src: AsyncIterable<Buffer>) {
          for await (const chunk of src) {
            received += chunk.length
            // servidor sem content-length mandando mais que o previsto: para na hora
            if (o.size && received > o.size) {
              tooBig = true
              throw new ChecksumError()
            }
            bump()
            o.onProgress?.(received, total)
            yield chunk
          }
        },
        createWriteStream(part, { flags: resumed ? 'a' : 'w' }),
        { signal }
      )
    } catch (e) {
      if (tooBig) {
        rmSync(part, { force: true })
        throw new ChecksumError()
      }
      throw e
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function downloadVerified(o: DownloadOptions): Promise<string> {
  checkUrl(o.url, !!o.allowLocalHttp)
  mkdirSync(dirname(o.dest), { recursive: true })
  if (existsSync(o.dest)) {
    try {
      await verifyOrDelete(o.dest, o.sha256)
      return o.dest
    } catch {
      /* estava estragado e foi apagado: baixa de novo */
    }
  }
  const part = `${o.dest}.part`
  if (o.size && sizeOf(part) > o.size) rmSync(part, { force: true })
  const retries = o.retries ?? 4
  for (let attempt = 0; ; attempt++) {
    if (o.signal?.aborted) throw new Error('Download cancelado')
    try {
      await fetchPart(o, part)
      break
    } catch (e) {
      if (o.signal?.aborted) throw new Error('Download cancelado', { cause: e })
      if (e instanceof ChecksumError || e instanceof UrlNotAllowedError || attempt >= retries) throw e
      // internet caiu: espera um pouco e continua de onde parou
      await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** attempt, 15_000)))
    }
  }
  await verifyOrDelete(part, o.sha256)
  renameSync(part, o.dest)
  return o.dest
}

/** Apaga downloads pela metade numa pasta (arquivos `.part`). */
export function clearPartial(dest: string): void {
  rmSync(`${dest}.part`, { force: true })
}
