import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HardwareInfo } from '../src/shared/types'
import { recommend, engineThreads } from '../src/main/ai/local/hardware'
import { ChecksumError, downloadVerified } from '../src/main/ai/local/download'
import {
  engineArgs,
  LocalEngine,
  type EngineChild,
  type EngineDeps,
  type EngineSpec
} from '../src/main/ai/local/engine'
import { ENGINE_ASSETS, LOCAL_MODELS } from '../src/main/ai/local/catalog'
import { candidates } from '../src/main/ai/router'
import type { AiProvider } from '../src/shared/types'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

const hw = (p: Partial<HardwareInfo>): HardwareInfo => ({
  platform: 'darwin',
  arch: 'arm64',
  totalMemGb: 8,
  freeMemGb: 2,
  cpus: 8,
  cpuModel: 'Apple M1',
  freeDiskGb: 50,
  ...p
})

describe('recomendação pelo computador', () => {
  test('8 GB: só o modelo leve + nuvem (médio não aparece)', () => {
    const r = recommend(hw({ totalMemGb: 8 }))
    expect(r).toMatchObject({ localSupported: true, localRecommended: true, offerMedium: false, primary: 'ambas' })
  })

  test('16 GB: oferece o modelo médio (opcional)', () => {
    expect(recommend(hw({ totalMemGb: 16 })).offerMedium).toBe(true)
    expect(recommend(hw({ totalMemGb: 15.9, platform: 'win32', arch: 'x64' })).offerMedium).toBe(true)
  })

  test('pouca memória ou pouco disco: só a nuvem', () => {
    expect(recommend(hw({ totalMemGb: 4 }))).toMatchObject({ localRecommended: false, primary: 'nuvem' })
    expect(recommend(hw({ freeDiskGb: 0.8 }))).toMatchObject({ localRecommended: false, primary: 'nuvem' })
    expect(recommend(hw({ totalMemGb: 32, freeDiskGb: 2 })).offerMedium).toBe(false) // sem disco para o médio
  })

  test('sistema sem motor pronto (Linux, Windows ARM): só a nuvem', () => {
    expect(recommend(hw({ platform: 'linux', arch: 'x64' })).localSupported).toBe(false)
    expect(recommend(hw({ platform: 'win32', arch: 'arm64' })).primary).toBe('nuvem')
  })

  test('aviso de lentidão em PC fraco e threads = metade dos núcleos', () => {
    expect(recommend(hw({ cpus: 2 })).slowWarning).toBe(true)
    expect(recommend(hw({ cpus: 8, totalMemGb: 16 })).slowWarning).toBe(false)
    expect(engineThreads(8)).toBe(4)
    expect(engineThreads(1)).toBe(1)
  })

  test('catálogo: tudo com SHA-256 fixo, https e modelo leve de até 1,7B', () => {
    for (const f of [...Object.values(ENGINE_ASSETS), ...LOCAL_MODELS]) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(f.url).toMatch(/^https:\/\/(github\.com\/ggml-org\/llama\.cpp|huggingface\.co)\//)
    }
    const leve = LOCAL_MODELS.find((m) => m.tier === 'leve')!
    expect(leve.size).toBeLessThan(1.3 * 1024 ** 3)
    expect(leve.ctx).toBeGreaterThanOrEqual(2048)
    expect(leve.ctx).toBeLessThanOrEqual(4096)
  })
})

// ---------- Download com conferência ----------

describe('download conferido por SHA-256', () => {
  const content = Buffer.from('conteúdo do modelo '.repeat(5000))
  const sha = createHash('sha256').update(content).digest('hex')
  let served = content
  let ranges: string[] = []
  let server: Server
  let base = ''

  beforeAll(async () => {
    server = createServer((req, res) => {
      const range = req.headers.range
      if (range) ranges.push(range)
      const m = range && /bytes=(\d+)-/.exec(range)
      if (m) {
        const start = Number(m[1])
        if (start >= served.length) {
          res.writeHead(416).end()
          return
        }
        res.writeHead(206, { 'content-length': served.length - start })
        res.end(served.subarray(start))
      } else {
        res.writeHead(200, { 'content-length': served.length })
        res.end(served)
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const addr = server.address()
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  })
  afterAll(() => server.close())
  afterEach(() => {
    served = content
    ranges = []
  })

  const dir = (): string => mkdtempSync(join(tmpdir(), 'dsp-dl-'))

  test('arquivo certo: fica no lugar e mostra o progresso', async () => {
    const dest = join(dir(), 'modelo.gguf')
    const seen: number[] = []
    await downloadVerified({
      url: `${base}/m`,
      dest,
      sha256: sha,
      allowLocalHttp: true,
      onProgress: (r) => seen.push(r)
    })
    expect(readFileSync(dest).equals(content)).toBe(true)
    expect(existsSync(`${dest}.part`)).toBe(false)
    expect(seen.at(-1)).toBe(content.length)
  })

  test('arquivo corrompido: é recusado e apagado', async () => {
    served = Buffer.from(content)
    served[10] = served[10] ^ 0xff
    const dest = join(dir(), 'modelo.gguf')
    await expect(
      downloadVerified({ url: `${base}/m`, dest, sha256: sha, allowLocalHttp: true, retries: 0 })
    ).rejects.toBeInstanceOf(ChecksumError)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  test('continua de onde parou (Range) quando a internet caiu antes', async () => {
    const dest = join(dir(), 'modelo.gguf')
    writeFileSync(`${dest}.part`, content.subarray(0, 30_000))
    await downloadVerified({ url: `${base}/m`, dest, sha256: sha, allowLocalHttp: true })
    expect(ranges).toEqual(['bytes=30000-'])
    expect(readFileSync(dest).equals(content)).toBe(true)
  })

  test('arquivo já existente e estragado é baixado de novo', async () => {
    const dest = join(dir(), 'modelo.gguf')
    writeFileSync(dest, 'lixo')
    await downloadVerified({ url: `${base}/m`, dest, sha256: sha, allowLocalHttp: true })
    expect(readFileSync(dest).equals(content)).toBe(true)
  })

  test('só https (http só em 127.0.0.1 nos testes)', async () => {
    const dest = join(dir(), 'x')
    await expect(downloadVerified({ url: 'http://exemplo.com/x', dest, sha256: sha })).rejects.toThrow(/não permitido/)
    await expect(downloadVerified({ url: `${base}/m`, dest, sha256: sha })).rejects.toThrow(/não permitido/)
  })
})

// ---------- Gerente do motor ----------

class FakeChild implements EngineChild {
  killed = false
  private cbs: Array<(c: number | null) => void> = []
  kill(): void {
    if (this.killed) return
    this.killed = true
    for (const cb of this.cbs.splice(0)) cb(null)
  }
  onExit(cb: (c: number | null) => void): void {
    this.cbs.push(cb)
  }
  tail(): string {
    return ''
  }
}

function fakeDeps(): EngineDeps & { children: FakeChild[]; specs: EngineSpec[] } {
  const children: FakeChild[] = []
  const specs: EngineSpec[] = []
  let port = 40000
  return {
    children,
    specs,
    spawn: (spec) => {
      specs.push(spec)
      const c = new FakeChild()
      children.push(c)
      return c
    },
    freePort: async () => ++port,
    waitReady: async () => undefined
  }
}

const spec = (model = 'leve.gguf'): EngineSpec => ({
  binary: '/x/llama-server',
  modelPath: model,
  ctx: 4096,
  threads: 4
})

describe('gerente do motor local', () => {
  afterEach(() => vi.useRealTimers())

  test('não sobe sozinho; sobe na primeira tarefa e reaproveita na segunda', async () => {
    const deps = fakeDeps()
    const e = new LocalEngine(deps)
    expect(e.running).toBe(false)
    expect(deps.children).toHaveLength(0)
    const url1 = await e.run(spec(), async (url) => url)
    const url2 = await e.run(spec(), async (url) => url)
    expect(url1).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
    expect(url2).toBe(url1)
    expect(deps.children).toHaveLength(1)
    e.stop()
  })

  test('uma tarefa por vez (fila)', async () => {
    const e = new LocalEngine(fakeDeps())
    const order: string[] = []
    let release!: () => void
    const first = e.run(spec(), async () => {
      order.push('a-início')
      await new Promise<void>((r) => (release = r))
      order.push('a-fim')
    })
    const second = e.run(spec(), async () => {
      order.push('b')
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(order).toEqual(['a-início']) // a segunda espera
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['a-início', 'a-fim', 'b'])
    e.stop()
  })

  test('erro numa tarefa não trava a fila', async () => {
    const e = new LocalEngine(fakeDeps())
    await expect(e.run(spec(), async () => Promise.reject(new Error('falhou')))).rejects.toThrow('falhou')
    await expect(e.run(spec(), async () => 'ok')).resolves.toBe('ok')
    e.stop()
  })

  test('desliga depois de 5 minutos parado (zero de memória)', async () => {
    vi.useFakeTimers()
    const deps = fakeDeps()
    const e = new LocalEngine(deps)
    await e.run(spec(), async () => 'ok')
    expect(e.running).toBe(true)
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(e.running).toBe(true)
    // nova tarefa reinicia a contagem
    await e.run(spec(), async () => 'ok')
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(e.running).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000 + 10)
    expect(e.running).toBe(false)
    expect(deps.children[0].killed).toBe(true)
    // depois de desligado, sobe de novo sob demanda
    await e.run(spec(), async () => 'ok')
    expect(deps.children).toHaveLength(2)
    e.stop()
  })

  test('nunca dois modelos: trocar de modelo fecha o anterior', async () => {
    const deps = fakeDeps()
    const e = new LocalEngine(deps)
    await e.run(spec('leve.gguf'), async () => 'ok')
    await e.run(spec('medio.gguf'), async () => 'ok')
    expect(deps.children[0].killed).toBe(true)
    expect(deps.children.filter((c) => !c.killed)).toHaveLength(1)
    e.stop()
  })

  test('tarefa exclusiva (Whisper) desliga o motor antes de rodar', async () => {
    const deps = fakeDeps()
    const e = new LocalEngine(deps)
    await e.run(spec(), async () => 'ok')
    const r = await e.exclusive(async () => (e.running ? 'junto' : 'sozinho'))
    expect(r).toBe('sozinho')
  })

  test('motor que fecha sozinho sobe de novo na próxima tarefa', async () => {
    const deps = fakeDeps()
    const e = new LocalEngine(deps)
    await e.run(spec(), async () => 'ok')
    deps.children[0].kill() // caiu
    expect(e.running).toBe(false)
    await e.run(spec(), async () => 'ok')
    expect(deps.children).toHaveLength(2)
    e.stop()
  })

  test('falha ao abrir: erro claro e nada fica rodando', async () => {
    const deps = fakeDeps()
    deps.waitReady = async () => Promise.reject(new Error('O motor da IA fechou ao abrir'))
    const e = new LocalEngine(deps)
    await expect(e.run(spec(), async () => 'ok')).rejects.toThrow(/fechou ao abrir/)
    expect(e.running).toBe(false)
    expect(deps.children[0].killed).toBe(true)
  })

  test('argumentos enxutos: só 127.0.0.1, contexto curto, mmap, uma conversa, sem cache', () => {
    const a = engineArgs({ ...spec(), threads: 3 }, 41234, 'chave')
    const val = (k: string): string => a[a.indexOf(k) + 1]
    expect(val('--host')).toBe('127.0.0.1')
    expect(val('--port')).toBe('41234')
    expect(val('--ctx-size')).toBe('4096')
    expect(val('--threads')).toBe('3')
    expect(val('--parallel')).toBe('1')
    expect(val('--load-mode')).toBe('mmap')
    expect(val('--cache-ram')).toBe('0')
    expect(val('--api-key')).toBe('chave')
    expect(a).toContain('--no-webui')
    expect(a).toContain('--no-repack')
  })
})

// ---------- Roteador ----------

test('script de medição usa os mesmos arquivos e argumentos do app', () => {
  const script = readFileSync(join(__dirname, '../scripts/medir-ia-local.mjs'), 'utf8')
  for (const f of [...Object.values(ENGINE_ASSETS), ...LOCAL_MODELS]) expect(script).toContain(f.sha256)
  for (const m of LOCAL_MODELS) expect(script).toContain(m.url)
  for (const a of engineArgs(spec(), 1, 'k').filter((x) => x.startsWith('--'))) expect(script).toContain(`'${a}'`)
})

describe('roteador com IA no computador', () => {
  const p = (x: Partial<AiProvider>): AiProvider => ({
    id: 1,
    preset: 'groq',
    name: 'x',
    baseUrl: '',
    hasKey: true,
    modelFast: '',
    modelSmart: '',
    trainsOnData: false,
    rpm: null,
    rpd: null,
    paid: false,
    enabled: true,
    priority: 100,
    usedToday: 0,
    errorsToday: 0,
    cooldownUntil: 0,
    ...x
  })
  const list = [
    p({ id: 1, preset: 'groq', name: 'Groq' }),
    p({ id: 2, preset: 'local', name: 'Local', hasKey: false, priority: 50 }),
    p({ id: 3, preset: 'claude', name: 'Claude', paid: true })
  ]
  const s = { privacy: 'anonimizar' as const, paidMonthlyLimit: 10 }

  test('tarefa rápida prefere a IA no computador; caprichada prefere a nuvem', () => {
    expect(candidates(list, { customerData: false, tier: 'fast' }, s, 0).map((x) => x.name)).toEqual([
      'Local',
      'Groq',
      'Claude'
    ])
    expect(candidates(list, { customerData: false, tier: 'smart' }, s, 0).map((x) => x.name)).toEqual([
      'Groq',
      'Local',
      'Claude'
    ])
  })

  test('IA no computador entra mesmo no modo estrito (dados não saem do computador)', () => {
    const r = candidates(list, { customerData: true, tier: 'fast' }, { ...s, privacy: 'estrita' }, 0)
    expect(r[0].name).toBe('Local')
  })
})
