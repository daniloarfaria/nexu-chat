import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

let userData = mkdtempSync(join(tmpdir(), 'dsp-ials-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import { closeDb, openDb, setSetting } from '../src/main/db'
import { complete, listProviders } from '../src/main/ai/router'
import * as svc from '../src/main/ai/local/service'
import { ENGINE_VERSION } from '../src/main/ai/local/catalog'
import type { EngineChild, EngineDeps } from '../src/main/ai/local/engine'
import type { HardwareInfo, LocalAiProgress } from '../src/shared/types'

const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
const base = (): string => join(userData, 'ai-local')

class FakeChild implements EngineChild {
  pid = 4321
  killed = false
  private cbs: Array<(c: number | null) => void> = []
  kill(): void {
    if (this.killed) return
    this.killed = true
    // sai um pouco depois, como um processo de verdade
    setTimeout(() => this.cbs.splice(0).forEach((cb) => cb(0)), 20)
  }
  onExit(cb: (c: number | null) => void): void {
    this.cbs.push(cb)
  }
  tail(): string {
    return ''
  }
}
const children: FakeChild[] = []
const fakeEngine: EngineDeps = {
  spawn: () => {
    const c = new FakeChild()
    children.push(c)
    return c
  },
  freePort: async () => 45678,
  waitReady: async () => undefined
}

let memGb = 8
const hw = (): HardwareInfo => ({
  platform: 'darwin',
  arch: 'arm64',
  totalMemGb: memGb,
  freeMemGb: 2,
  cpus: 8,
  cpuModel: 'teste',
  freeDiskGb: 100
})

/** "Extração": cria o llama-server dentro de uma subpasta, como o pacote do Mac. */
let extractHook: ((signal: AbortSignal) => Promise<void>) | null = null
let extracting = false

beforeAll(() => {
  svc._deps.engineDeps = fakeEngine
  svc._deps.hardware = hw
  svc._deps.download = async (o) => {
    if (o.signal?.aborted) throw new Error('Download cancelado')
    mkdirSync(dirname(o.dest), { recursive: true })
    writeFileSync(o.dest, 'arquivo')
    o.onProgress?.(o.size ?? 1, o.size ?? 1)
    return o.dest
  }
  svc._deps.extract = async (_archive, dest, signal) => {
    extracting = true
    try {
      if (extractHook) await extractHook(signal)
      mkdirSync(join(dest, 'llama-x'), { recursive: true })
      writeFileSync(join(dest, 'llama-x', exe), '#!/bin/sh\n')
    } finally {
      extracting = false
    }
  }
})

const realRemove = svc._deps.remove

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'dsp-ials-'))
  closeDb()
  openDb(join(userData, 'db.sqlite'))
  memGb = 8
  extractHook = null
  svc._deps.remove = realRemove
  svc._deps.processPath = async () => null
  svc._deps.killPid = () => undefined
  svc._resetEngine()
  svc.initLocalAi()
})

const progress: Array<LocalAiProgress | null> = []
const onP = (p: LocalAiProgress | null): void => void progress.push(p)
const local = (): ReturnType<typeof listProviders>[number] | undefined =>
  listProviders().find((p) => p.preset === 'local')

/** Faz o motor subir: o pedido falha (não há servidor de verdade), mas o motor fica ligado. */
async function startEngine(): Promise<void> {
  await complete({ task: 't', tier: 'fast', system: 's', prompt: 'p', customerData: false, maxTokens: 10 }).catch(
    () => undefined
  )
}

describe('IA local: instalar, desligar o médio e remover', () => {
  test('instalar o leve registra o provedor e mostra o progresso até o fim', async () => {
    progress.length = 0
    const st = await svc.installLocal('leve', onP)
    expect(st.engineInstalled).toBe(true)
    expect(st.models.find((m) => m.tier === 'leve')?.installed).toBe(true)
    expect(local()).toMatchObject({ modelFast: 'gemma3-1b', modelSmart: 'gemma3-1b', enabled: true })
    expect(progress.at(-1)).toBeNull()
    expect(existsSync(join(base(), 'downloads'))).toBe(true)
  })

  test('modelo médio só com 16 GB; desligar espera o motor sair antes de apagar', async () => {
    await expect(svc.installLocal('medio', onP)).rejects.toThrow(/16 GB/)
    memGb = 16
    await svc.installLocal('medio', onP)
    expect(local()?.modelSmart).toBe('qwen3-4b')
    await startEngine()
    expect(children.at(-1)?.killed).toBe(false)
    expect(existsSync(join(base(), 'run', 'motor.pid'))).toBe(true) // PID guardado enquanto roda
    let aliveWhenRemoving: boolean | null = null
    svc._deps.remove = async (p) => {
      aliveWhenRemoving = children.some((c) => !c.killed)
      await realRemove(p)
    }
    const st = await svc.disableMedium()
    expect(aliveWhenRemoving).toBe(false)
    expect(st.mediumEnabled).toBe(false)
    expect(st.models.find((m) => m.tier === 'medio')?.installed).toBe(false)
    expect(existsSync(join(base(), 'models', 'Qwen3-4B-Q4_K_M.gguf'))).toBe(false)
    expect(local()?.modelSmart).toBe('gemma3-1b')
    expect(existsSync(join(base(), 'run', 'motor.pid'))).toBe(false)
  })

  test('remover: para o motor, apaga a pasta e tira o provedor', async () => {
    await svc.installLocal('leve', onP)
    await startEngine()
    const st = await svc.removeLocal()
    expect(children.every((c) => c.killed)).toBe(true)
    expect(existsSync(base())).toBe(false)
    expect(local()).toBeUndefined()
    expect(st.engineInstalled).toBe(false)
  })

  test('remover com arquivo preso (Windows): mensagem clara, mas o app já para de usar a IA local', async () => {
    await svc.installLocal('leve', onP)
    svc._deps.remove = async () => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    }
    await expect(svc.removeLocal()).rejects.toThrow(/algum programa ainda está usando/)
    expect(local()).toBeUndefined()
    expect(svc.localStatus().engineInstalled).toBe(false)
  })

  test('remover durante a extração cancela o tar e apaga tudo', async () => {
    extractHook = (signal) =>
      new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('tar morto'))))
    const inst = svc.installLocal('leve', onP).then(
      () => null,
      (e: Error) => e
    )
    await vi.waitFor(() => expect(extracting).toBe(true))
    await svc.removeLocal()
    expect((await inst)?.message).toMatch(/tar morto/)
    expect(existsSync(base())).toBe(false)
    expect(local()).toBeUndefined()
  })
})

describe('IA local: endurecimento', () => {
  test('caminho do motor vindo das configurações não sai da pasta do motor', () => {
    const fora = join(base(), 'models', exe)
    mkdirSync(dirname(fora), { recursive: true })
    writeFileSync(fora, 'x')
    setSetting('ai.local', { engineVersion: ENGINE_VERSION, engineBinary: join('models', exe), models: [] })
    expect(svc.localStatus().engineInstalled).toBe(false)
    setSetting('ai.local', { engineVersion: ENGINE_VERSION, engineBinary: `../../${exe}`, models: [] })
    expect(svc.localStatus().engineInstalled).toBe(false)
    const dentro = join(base(), 'engine', ENGINE_VERSION, 'llama-x', exe)
    mkdirSync(dirname(dentro), { recursive: true })
    writeFileSync(dentro, 'x')
    setSetting('ai.local', {
      engineVersion: ENGINE_VERSION,
      engineBinary: join('engine', ENGINE_VERSION, 'llama-x', exe),
      models: []
    })
    expect(svc.localStatus().engineInstalled).toBe(true)
  })

  test('motor que ficou para trás depois de o app cair é encerrado, só se for o llama-server', async () => {
    const pid = join(base(), 'run', 'motor.pid')
    const killed: number[] = []
    svc._deps.killPid = (n) => void killed.push(n)
    mkdirSync(dirname(pid), { recursive: true })

    writeFileSync(pid, '4242')
    svc._deps.processPath = async () => join(base(), 'engine', ENGINE_VERSION, 'llama-x', exe)
    expect(await svc.killOrphan()).toBe(true)
    expect(killed).toEqual([4242])
    expect(existsSync(pid)).toBe(false)

    writeFileSync(pid, '4243')
    svc._deps.processPath = async () => 'Safari' // o PID foi reaproveitado por outro programa
    expect(await svc.killOrphan()).toBe(false)
    expect(killed).toEqual([4242])

    // órfão de uma versão anterior do motor (pasta engine/<versão antiga>) também é encerrado
    writeFileSync(pid, '4250')
    svc._deps.processPath = async () => join(base(), 'engine', 'b0000-antiga', 'llama-x', exe)
    expect(await svc.killOrphan()).toBe(true)
    expect(killed).toEqual([4242, 4250])
    killed.length = 0
    killed.push(4242)

    writeFileSync(pid, '4244')
    // mesmo nome de programa, mas de outro lugar (outro llama-server do usuário): não encerra
    svc._deps.processPath = async () => join('/Users/x/outro', exe)
    expect(await svc.killOrphan()).toBe(false)
    svc._deps.processPath = async () => exe // só o nome, sem caminho completo
    writeFileSync(pid, '4245')
    expect(await svc.killOrphan()).toBe(false)
    expect(killed).toEqual([4242])

    writeFileSync(pid, 'lixo')
    expect(await svc.killOrphan()).toBe(false)
    expect(killed).toEqual([4242])
  })
})

describe('IA local: encerramento e PID', () => {
  test('motor antigo que sai tarde não apaga o PID do motor novo', () => {
    const pid = join(base(), 'run', 'motor.pid')
    mkdirSync(dirname(pid), { recursive: true })
    writeFileSync(pid, '222')
    svc._releasePidFile(111) // o antigo saiu depois do novo subir
    expect(existsSync(pid)).toBe(true)
    svc._releasePidFile(222)
    expect(existsSync(pid)).toBe(false)
  })

  test('encerrar o app para o motor e recusa tarefa nova', async () => {
    await svc.installLocal('leve', onP)
    await startEngine()
    const antes = children.length
    expect(children.at(-1)?.killed).toBe(false)
    await svc.shutdownLocalAi()
    expect(children.at(-1)?.killed).toBe(true)
    await startEngine() // o pedido falha, mas nenhum motor novo sobe
    expect(children).toHaveLength(antes)
  })

  test('remover passa pela fila: espera a tarefa em andamento terminar', async () => {
    await svc.installLocal('leve', onP)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let ended = false
    const task = svc.exclusiveLocal(async () => {
      await gate
      ended = true
    })
    let removed = false
    const rm = svc.removeLocal().then(() => (removed = true))
    await new Promise((r) => setTimeout(r, 50))
    expect(removed).toBe(false)
    release()
    await task
    await rm
    expect(ended).toBe(true)
    expect(removed).toBe(true)
  })
})
