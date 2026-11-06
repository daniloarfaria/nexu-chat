import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { dirname } from 'node:path'

/**
 * Gerente do motor local (llama-server). Regras de memória baixa:
 * - sobe só na primeira tarefa e fecha depois de 5 min parado (parado = zero de memória);
 * - uma tarefa por vez (fila), e nunca dois modelos ao mesmo tempo;
 * - contexto curto, mmap ligado, metade dos núcleos, sem cache de prompts na memória;
 * - escuta só em 127.0.0.1, numa porta livre, com uma chave nova a cada vez que sobe.
 */

export interface EngineSpec {
  binary: string
  modelPath: string
  ctx: number
  threads: number
  extraArgs?: string[]
}

export interface EngineChild {
  kill(): void
  /** chamado uma vez quando o processo termina (sozinho ou por kill) */
  onExit(cb: (code: number | null) => void): void
  /** últimas linhas do log, para mostrar no erro */
  tail(): string
}

export interface EngineDeps {
  spawn(spec: EngineSpec, port: number, apiKey: string): EngineChild
  freePort(): Promise<number>
  waitReady(baseUrl: string, apiKey: string, child: EngineChild): Promise<void>
}

export const IDLE_MS = 5 * 60_000

/** Argumentos do llama-server (função pura para teste). */
export function engineArgs(spec: EngineSpec, port: number, apiKey: string): string[] {
  return [
    '--model', spec.modelPath,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--api-key', apiKey,
    '--ctx-size', String(spec.ctx),
    '--threads', String(spec.threads),
    '--threads-batch', String(spec.threads),
    '--parallel', '1', // uma conversa por vez
    '--load-mode', 'mmap', // o sistema pode devolver a memória do modelo
    '--cache-ram', '0', // sem cache de prompts na memória (padrão seria até 8 GB)
    '--no-webui',
    '--no-slots',
    ...(spec.extraArgs ?? [])
  ] // prettier-ignore
}

export class LocalEngine {
  private child: EngineChild | null = null
  private current: { key: string; baseUrl: string; apiKey: string } | null = null
  private tailP: Promise<unknown> = Promise.resolve()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private pending = 0

  constructor(
    private deps: EngineDeps,
    private idleMs = IDLE_MS
  ) {}

  get running(): boolean {
    return !!this.child
  }

  get busy(): boolean {
    return this.pending > 0
  }

  /** Põe uma tarefa na fila (uma por vez). */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.pending++
    this.clearIdle()
    const p = this.tailP.then(task, task)
    this.tailP = p.then(
      () => this.done(),
      () => this.done()
    )
    return p
  }

  private done(): void {
    this.pending--
    if (this.pending === 0 && this.child) this.idleTimer = setTimeout(() => this.stop(), this.idleMs)
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  /** Roda um pedido no modelo indicado, subindo (ou trocando) o motor se precisar. */
  run<T>(spec: EngineSpec, fn: (baseUrl: string, apiKey: string) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const { baseUrl, apiKey } = await this.ensure(spec)
      return fn(baseUrl, apiKey)
    })
  }

  /**
   * Roda algo pesado que não pode dividir memória com o modelo de texto (ex.: Whisper):
   * entra na mesma fila e desliga o motor antes.
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.stop()
      return fn()
    })
  }

  private async ensure(spec: EngineSpec): Promise<{ baseUrl: string; apiKey: string }> {
    const key = `${spec.binary}|${spec.modelPath}|${spec.ctx}|${spec.threads}|${(spec.extraArgs ?? []).join(' ')}`
    if (this.child && this.current?.key === key) return this.current
    this.stop() // outro modelo: nunca dois ao mesmo tempo
    const port = await this.deps.freePort()
    const apiKey = randomBytes(24).toString('hex')
    const child = this.deps.spawn(spec, port, apiKey)
    const baseUrl = `http://127.0.0.1:${port}/v1`
    this.child = child
    this.current = { key, baseUrl, apiKey }
    child.onExit(() => {
      if (this.child === child) {
        this.child = null
        this.current = null
      }
    })
    try {
      await this.deps.waitReady(`http://127.0.0.1:${port}`, apiKey, child)
    } catch (e) {
      this.stop()
      throw e
    }
    return { baseUrl, apiKey }
  }

  /** Desliga o motor agora (libera toda a memória). */
  stop(): void {
    this.clearIdle()
    const c = this.child
    this.child = null
    this.current = null
    c?.kill()
  }
}

// ---------- Implementação real ----------

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port ? resolve(port) : reject(new Error('Sem porta livre'))))
    })
  })
}

function spawnEngine(spec: EngineSpec, port: number, apiKey: string): EngineChild {
  const proc = spawn(spec.binary, engineArgs(spec, port, apiKey), {
    cwd: dirname(spec.binary),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  const lines: string[] = []
  const keep = (b: Buffer): void => {
    lines.push(...b.toString('utf8').split(/\r?\n/).filter(Boolean))
    if (lines.length > 30) lines.splice(0, lines.length - 30)
  }
  proc.stdout?.on('data', keep)
  proc.stderr?.on('data', keep)
  let exited = false
  let code: number | null = null
  const waiters: Array<(c: number | null) => void> = []
  const finish = (c: number | null): void => {
    if (exited) return
    exited = true
    code = c
    for (const w of waiters.splice(0)) w(c)
  }
  proc.on('exit', (c) => finish(c))
  proc.on('error', (e) => {
    lines.push(e.message)
    finish(-1)
  })
  return {
    kill: () => {
      if (!exited) proc.kill()
    },
    onExit: (cb) => (exited ? cb(code) : waiters.push(cb)),
    tail: () => lines.slice(-8).join('\n')
  }
}

async function waitReady(base: string, apiKey: string, child: EngineChild, timeoutMs = 180_000): Promise<void> {
  let dead = false
  child.onExit(() => (dead = true))
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (dead) throw new Error(`O motor da IA fechou ao abrir. ${child.tail()}`.trim())
    try {
      const r = await fetch(`${base}/health`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(2000)
      })
      await r.body?.cancel().catch(() => undefined)
      if (r.ok) return
    } catch {
      /* ainda abrindo */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  child.kill()
  throw new Error('O motor da IA demorou demais para abrir')
}

export const realEngineDeps: EngineDeps = { spawn: spawnEngine, freePort, waitReady }
