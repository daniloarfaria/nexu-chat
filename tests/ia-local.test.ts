import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HardwareInfo } from '../src/shared/types'
import { recommend, engineThreads } from '../src/main/ai/local/hardware'
import { ChecksumError, downloadVerified, UrlNotAllowedError } from '../src/main/ai/local/download'
import {
  engineArgs,
  LocalEngine,
  type EngineChild,
  type EngineDeps,
  type EngineSpec
} from '../src/main/ai/local/engine'
import { ENGINE_ASSETS, LOCAL_MODELS } from '../src/main/ai/local/catalog'
import {
  candidates,
  complete,
  estimateTokens,
  listProviders,
  localFits,
  saveProvider,
  setLocalRunner,
  upsertLocalProvider
} from '../src/main/ai/router'
import { closeDb, getDb, openDb } from '../src/main/db'
import type { AiProvider, AiSettings } from '../src/shared/types'

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
      if (req.url === '/redir-ok') return void res.writeHead(302, { location: '/m' }).end()
      if (req.url === '/redir-ruim') {
        const port = (server.address() as { port: number }).port
        return void res.writeHead(302, { location: `http://localhost:${port}/m` }).end()
      }
      if (req.url === '/sem-tamanho') {
        // sem content-length (chunked), mandando o dobro do previsto
        res.writeHead(200)
        res.write(served)
        res.end(served)
        return
      }
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

  test('redirecionamento: confere o endereço de destino de novo', async () => {
    const dest = join(dir(), 'm.gguf')
    await downloadVerified({ url: `${base}/redir-ok`, dest, sha256: sha, allowLocalHttp: true })
    expect(readFileSync(dest).equals(content)).toBe(true)
    const dest2 = join(dir(), 'm.gguf')
    await expect(
      downloadVerified({ url: `${base}/redir-ruim`, dest: dest2, sha256: sha, allowLocalHttp: true })
    ).rejects.toBeInstanceOf(UrlNotAllowedError)
    expect(existsSync(dest2)).toBe(false)
  })

  test('servidor sem tamanho mandando mais que o previsto: para e apaga', async () => {
    const dest = join(dir(), 'm.gguf')
    await expect(
      downloadVerified({ url: `${base}/sem-tamanho`, dest, sha256: sha, size: content.length, allowLocalHttp: true })
    ).rejects.toBeInstanceOf(ChecksumError)
    expect(existsSync(`${dest}.part`)).toBe(false)
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
  forced = false
  /** ignora o pedido normal de fechar (processo travado) */
  stubborn = false
  private cbs: Array<(c: number | null) => void> = []
  kill(force?: boolean): void {
    if (this.killed) return
    if (this.stubborn && !force) return
    this.forced = !!force
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
  threads: 4,
  runDir: '/tmp/x'
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
    await e.stop()
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
    await e.stop()
  })

  test('erro numa tarefa não trava a fila', async () => {
    const e = new LocalEngine(fakeDeps())
    await expect(e.run(spec(), async () => Promise.reject(new Error('falhou')))).rejects.toThrow('falhou')
    await expect(e.run(spec(), async () => 'ok')).resolves.toBe('ok')
    await e.stop()
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
    await e.stop()
  })

  test('nunca dois modelos: trocar de modelo fecha o anterior', async () => {
    const deps = fakeDeps()
    const e = new LocalEngine(deps)
    await e.run(spec('leve.gguf'), async () => 'ok')
    await e.run(spec('medio.gguf'), async () => 'ok')
    expect(deps.children[0].killed).toBe(true)
    expect(deps.children.filter((c) => !c.killed)).toHaveLength(1)
    await e.stop()
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
    await e.stop()
  })

  test('falha ao abrir: erro claro e nada fica rodando', async () => {
    const deps = fakeDeps()
    deps.waitReady = async () => Promise.reject(new Error('O motor da IA fechou ao abrir'))
    const e = new LocalEngine(deps)
    await expect(e.run(spec(), async () => 'ok')).rejects.toThrow(/fechou ao abrir/)
    expect(e.running).toBe(false)
    expect(deps.children[0].killed).toBe(true)
  })

  test('desligar espera o processo sair', async () => {
    const deps = fakeDeps()
    const e = new LocalEngine(deps)
    await e.run(spec(), async () => 'ok')
    await e.stop()
    expect(deps.children[0].killed).toBe(true)
    expect(deps.children[0].forced).toBe(false)
  })

  test('processo que não fecha é morto à força depois do tempo', async () => {
    vi.useFakeTimers()
    const deps = fakeDeps()
    const e = new LocalEngine(deps)
    await e.run(spec(), async () => 'ok')
    deps.children[0].stubborn = true
    let done = false
    const p = e.stop().then(() => (done = true))
    await vi.advanceTimersByTimeAsync(4000)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1100)
    await p
    expect(deps.children[0].forced).toBe(true)
  })

  test('paradas ao mesmo tempo esperam a mesma saída e não sobem dois motores', async () => {
    const deps = fakeDeps()
    const e = new LocalEngine(deps)
    await e.run(spec(), async () => 'ok')
    const c0 = deps.children[0]
    c0.stubborn = true
    vi.useFakeTimers()
    let second = false
    const p1 = e.stop()
    const p2 = e.stop().then(() => (second = true))
    await vi.advanceTimersByTimeAsync(1000)
    expect(second).toBe(false) // a segunda parada não resolve antes do processo sair
    await vi.advanceTimersByTimeAsync(5000)
    await Promise.all([p1, p2])
    expect(c0.killed).toBe(true)
    vi.useRealTimers()
    await e.run(spec(), async () => 'ok')
    expect(deps.children.filter((c) => !c.killed)).toHaveLength(1)
  })

  test('depois de shutdown não aceita tarefa nova e o motor fica parado', async () => {
    const deps = fakeDeps()
    const e = new LocalEngine(deps)
    await e.run(spec(), async () => 'ok')
    await e.shutdown()
    expect(e.running).toBe(false)
    await expect(e.run(spec(), async () => 'x')).rejects.toThrow(/encerrando/)
    await expect(e.exclusive(async () => 'x')).rejects.toThrow(/encerrando/)
    expect(deps.children).toHaveLength(1)
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
    expect(val('--api-key-file')).toBe('chave') // a chave vai em arquivo, não na linha de comando
    expect(a).not.toContain('--api-key')
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
  const groq = p({ id: 1, preset: 'groq', name: 'Groq' })
  const gemini = p({ id: 4, preset: 'gemini', name: 'Gemini', trainsOnData: true })
  const leve = p({
    id: 2,
    preset: 'local',
    name: 'Local',
    hasKey: false,
    priority: 50,
    modelFast: 'gemma3-1b',
    modelSmart: 'gemma3-1b'
  })
  const medio = { ...leve, modelSmart: 'qwen3-4b' }
  const claude = p({ id: 3, preset: 'claude', name: 'Claude', paid: true })
  const s: AiSettings = { privacy: 'anonimizar', paidMonthlyLimit: 10 }
  const names = (list: AiProvider[], req: Parameters<typeof candidates>[1], set = s): string[] =>
    candidates(list, req, set).map((x) => x.name)

  test('sem IA local: nada muda', () => {
    expect(names([groq, claude], { customerData: false, tier: 'fast' })).toEqual(['Groq', 'Claude'])
    expect(names([groq, claude], { customerData: false, tier: 'smart' })).toEqual(['Groq', 'Claude'])
  })

  test('só o modelo leve: rápida vai para a local; caprichada (sugerir resposta) vai para a nuvem', () => {
    expect(names([groq, leve, claude], { customerData: false, tier: 'fast' })).toEqual(['Local', 'Groq', 'Claude'])
    expect(names([groq, leve, claude], { customerData: false, tier: 'smart' })).toEqual(['Groq', 'Local', 'Claude'])
  })

  test('modelo médio ligado: a local vem primeiro também na caprichada', () => {
    expect(names([groq, medio, claude], { customerData: false, tier: 'smart' })).toEqual(['Local', 'Groq', 'Claude'])
  })

  test('premium: o pago primeiro, depois os gratuitos na ordem da tarefa', () => {
    expect(names([groq, leve, claude], { customerData: false, tier: 'smart', premium: true })).toEqual([
      'Claude',
      'Groq',
      'Local'
    ])
    expect(names([groq, leve, claude], { customerData: false, tier: 'fast', premium: true })).toEqual([
      'Claude',
      'Local',
      'Groq'
    ])
  })

  test('modo estrito: tira quem treina com os dados, a local continua', () => {
    const est = { ...s, privacy: 'estrita' as const }
    expect(names([gemini, groq, leve], { customerData: true, tier: 'smart' }, est)).toEqual(['Groq', 'Local'])
    expect(names([gemini, leve], { customerData: true, tier: 'fast' }, est)).toEqual(['Local'])
  })

  test('cabe no contexto? conta o pedido e a resposta', () => {
    expect(estimateTokens(3000)).toBe(1064)
    expect(localFits({ system: 'a'.repeat(3000), prompt: 'b'.repeat(3000), maxTokens: 600 }, 4096)).toBe(true)
    expect(localFits({ system: 'a'.repeat(6000), prompt: 'b'.repeat(6000), maxTokens: 600 }, 4096)).toBe(false)
    expect(localFits({ system: 'a'.repeat(900), prompt: 'b', maxTokens: 4000 }, 4096)).toBe(false) // resposta longa (playbook)
  })
})

describe('roteador: pedido grande demais para a IA local', () => {
  let llm: Server
  let url = ''
  let calls = 0
  beforeAll(async () => {
    // llama-server falso: responde 400 de contexto excedido
    llm = createServer((_req, res) => {
      calls++
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: { type: 'exceed_context_size_error', message: 'the request exceeds the available context size' }
        })
      )
    })
    await new Promise<void>((r) => llm.listen(0, '127.0.0.1', () => r()))
    url = `http://127.0.0.1:${(llm.address() as { port: number }).port}/v1`
  })
  afterAll(() => {
    llm.close()
    setLocalRunner(null)
  })

  const setup = (): number => {
    closeDb()
    openDb(join(mkdtempSync(join(tmpdir(), 'dsp-rt-')), 'db.sqlite'))
    upsertLocalProvider('gemma3-1b', 'gemma3-1b')
    calls = 0
    let runs = 0
    setLocalRunner(
      async (_m, fn) => {
        runs++
        return fn(url, 'k')
      },
      () => 4096
    )
    return runs
  }
  const req = (chars: number): Parameters<typeof complete>[0] => ({
    task: 't',
    tier: 'fast',
    system: 's',
    prompt: 'x'.repeat(chars),
    customerData: false,
    maxTokens: 100
  })
  const local = (): AiProvider => listProviders().find((x) => x.preset === 'local')!

  test('estimativa diz que não cabe: pula a local sem chamar o motor e sem pausar', async () => {
    setup()
    await expect(complete(req(20_000))).rejects.toThrow(/grande demais/)
    expect(calls).toBe(0)
    expect(local().cooldownUntil).toBe(0)
    expect(local().errorsToday).toBe(0)
  })

  test('motor responde 400 de contexto: sem pausa longa, segue para o próximo', async () => {
    setup()
    await expect(complete(req(1000))).rejects.toThrow(/grande demais/)
    expect(calls).toBe(1)
    expect(local().cooldownUntil).toBe(0)
    // continua disponível para o próximo pedido
    expect(
      candidates(listProviders(), { customerData: false, tier: 'fast' }, { privacy: 'anonimizar', paidMonthlyLimit: 0 })
    ).toHaveLength(1)
  })

  test('não deixa criar IA local pela tela de provedores', () => {
    setup()
    expect(() => saveProvider({ preset: 'local' })).toThrow(/Configurar IA/)
    getDb().prepare('DELETE FROM ai_providers').run()
  })
})
