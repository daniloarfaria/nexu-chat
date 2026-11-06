import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import type { LocalAiProgress, LocalAiStatus, LocalModelTier } from '@shared/types'
import { getSetting, setSetting } from '../../db'
import { log } from '../../log'
import { removeLocalProvider, setLocalRunner, upsertLocalProvider } from '../router'
import { ENGINE_VERSION, engineAssetFor, LOCAL_MODELS, lightModel, mediumModel, modelById } from './catalog'
import { clearPartial, downloadVerified } from './download'
import { LocalEngine, realEngineDeps } from './engine'
import { detectHardware, engineThreads, recommend } from './hardware'

/**
 * IA no computador: instala (baixa e confere), registra como provedor e roda sob demanda.
 * Tudo fica em `userData/ai-local/`. "Remover IA local" apaga só essa pasta.
 */

const run = promisify(execFile)

interface LocalState {
  engineVersion: string | null
  /** caminho do llama-server relativo à pasta ai-local */
  engineBinary: string | null
  /** modelos baixados e conferidos */
  models: string[]
  mediumEnabled: boolean
}

const DEFAULT: LocalState = { engineVersion: null, engineBinary: null, models: [], mediumEnabled: false }
const getState = (): LocalState => ({ ...DEFAULT, ...getSetting<Partial<LocalState>>('ai.local', {}) })
const setState = (patch: Partial<LocalState>): LocalState => {
  const next = { ...getState(), ...patch }
  setSetting('ai.local', next)
  return next
}

const baseDir = (): string => join(app.getPath('userData'), 'ai-local')
const modelPath = (file: string): string => join(baseDir(), 'models', file)
const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'

const engine = new LocalEngine(realEngineDeps)
let installing: { progress: LocalAiProgress; abort: AbortController } | null = null

function engineBinary(s = getState()): string | null {
  if (!s.engineBinary || s.engineVersion !== ENGINE_VERSION) return null
  const p = join(baseDir(), s.engineBinary)
  return existsSync(p) ? p : null
}

function modelInstalled(id: string, s = getState()): boolean {
  const m = modelById(id)
  return !!m && s.models.includes(id) && existsSync(modelPath(m.file))
}

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += statSync(join(e.parentPath, e.name)).size
  }
  return total
}

export function localStatus(): LocalAiStatus {
  const s = getState()
  const hardware = detectHardware(app.getPath('userData'))
  const rec = recommend(hardware)
  return {
    hardware,
    recommendation: rec,
    engineInstalled: !!engineBinary(s),
    engineVersion: ENGINE_VERSION,
    models: LOCAL_MODELS.map((m) => ({
      id: m.id,
      tier: m.tier,
      name: m.name,
      sizeMb: Math.round(m.size / 1024 ** 2),
      installed: modelInstalled(m.id, s),
      offered: m.tier === 'leve' ? rec.localSupported : rec.offerMedium
    })),
    mediumEnabled: s.mediumEnabled && modelInstalled(mediumModel().id, s),
    running: engine.running,
    installing: installing?.progress ?? null,
    diskUsedMb: Math.round(dirSize(baseDir()) / 1024 ** 2)
  }
}

/** Acha o llama-server dentro da pasta extraída (o pacote do Mac tem uma subpasta). */
function findBinary(dir: string): string | null {
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && e.name === exeName) return join(e.parentPath, e.name)
  }
  return null
}

async function extract(archive: string, dest: string): Promise<void> {
  // tar do próprio sistema: no Mac (/usr/bin/tar) e no Windows 10+ (System32\tar.exe, também abre .zip).
  // Ele recusa caminhos absolutos e "..", então nada sai da pasta de destino.
  const tar =
    process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar'
  mkdirSync(dest, { recursive: true })
  await run(tar, ['-xf', archive, '-C', dest], { timeout: 120_000, windowsHide: true })
  if (process.platform === 'darwin') {
    // arquivo conferido pelo SHA-256: tira a marca de "baixado da internet" para o macOS deixar rodar
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dest], { timeout: 30_000 }).catch(() => undefined)
  }
}

async function installEngine(signal: AbortSignal, progress: (p: LocalAiProgress) => void): Promise<void> {
  if (engineBinary()) return
  const asset = engineAssetFor(process.platform, process.arch)
  if (!asset) throw new Error('Este sistema ainda não tem a IA no computador')
  const archive = join(baseDir(), 'downloads', asset.file)
  await downloadVerified({
    url: asset.url,
    dest: archive,
    sha256: asset.sha256,
    size: asset.size,
    signal,
    onProgress: (received, total) => progress({ stage: 'motor', label: 'Baixando o motor da IA', received, total })
  })
  progress({ stage: 'preparando', label: 'Preparando o motor', received: 0, total: 0 })
  const tmp = join(baseDir(), 'engine', `${ENGINE_VERSION}.tmp`)
  const final = join(baseDir(), 'engine', ENGINE_VERSION)
  rmSync(tmp, { recursive: true, force: true })
  await extract(archive, tmp)
  if (!findBinary(tmp)) throw new Error('O pacote do motor veio sem o llama-server')
  rmSync(final, { recursive: true, force: true })
  renameSync(tmp, final)
  const bin = findBinary(final)!
  rmSync(archive, { force: true }) // o pacote já foi conferido e extraído
  // versões antigas do motor saem
  for (const d of readdirSync(join(baseDir(), 'engine'))) {
    if (d !== ENGINE_VERSION) rmSync(join(baseDir(), 'engine', d), { recursive: true, force: true })
  }
  setState({ engineVersion: ENGINE_VERSION, engineBinary: relative(baseDir(), bin) })
}

async function installModel(
  id: string,
  signal: AbortSignal,
  progress: (p: LocalAiProgress) => void
): Promise<void> {
  if (modelInstalled(id)) return
  const m = modelById(id)!
  await downloadVerified({
    url: m.url,
    dest: modelPath(m.file),
    sha256: m.sha256,
    size: m.size,
    signal,
    onProgress: (received, total) =>
      progress({
        stage: received >= total && total > 0 ? 'conferindo' : 'modelo',
        label: received >= total && total > 0 ? 'Conferindo o arquivo' : `Baixando ${m.name}`,
        received,
        total
      })
  })
  const s = getState()
  setState({ models: [...new Set([...s.models, id])] })
}

function registerProvider(): void {
  const s = getState()
  const light = lightModel().id
  const medium = s.mediumEnabled && modelInstalled(mediumModel().id, s) ? mediumModel().id : light
  if (engineBinary(s) && modelInstalled(light, s)) upsertLocalProvider(light, medium)
}

/** Instala o motor e o modelo do nível pedido. Continua de onde parou se a internet caiu antes. */
export async function installLocal(
  tier: LocalModelTier,
  onProgress: (p: LocalAiProgress | null) => void
): Promise<LocalAiStatus> {
  if (installing) throw new Error('A instalação já está em andamento')
  const st = localStatus()
  if (!st.recommendation.localSupported) throw new Error('Este sistema ainda não tem a IA no computador')
  if (tier === 'medio' && !st.recommendation.offerMedium)
    throw new Error('O modelo médio precisa de 16 GB de memória ou mais')
  const ctrl = new AbortController()
  const progress = (p: LocalAiProgress): void => {
    if (installing) installing.progress = p
    onProgress(p)
  }
  installing = { progress: { stage: 'motor', label: 'Começando', received: 0, total: 0 }, abort: ctrl }
  try {
    await installEngine(ctrl.signal, progress)
    await installModel(lightModel().id, ctrl.signal, progress)
    if (tier === 'medio') {
      await installModel(mediumModel().id, ctrl.signal, progress)
      setState({ mediumEnabled: true })
    }
    registerProvider()
    log.info('IA no computador instalada', { nivel: tier, motor: ENGINE_VERSION })
  } finally {
    installing = null
    onProgress(null)
  }
  return localStatus()
}

/** Para o download. O pedaço já baixado fica guardado para continuar depois. */
export function cancelInstall(): void {
  installing?.abort.abort()
}

/** Desliga o modelo médio e apaga o arquivo dele (volta a usar só o leve). */
export function disableMedium(): LocalAiStatus {
  engine.stop()
  const m = mediumModel()
  rmSync(modelPath(m.file), { force: true })
  clearPartial(modelPath(m.file))
  const s = getState()
  setState({ mediumEnabled: false, models: s.models.filter((x) => x !== m.id) })
  registerProvider()
  return localStatus()
}

/** Apaga a pasta da IA local inteira (motor, modelos e downloads pela metade) e o provedor. */
export function removeLocal(): LocalAiStatus {
  installing?.abort.abort()
  engine.stop()
  rmSync(baseDir(), { recursive: true, force: true })
  setSetting('ai.local', DEFAULT)
  removeLocalProvider()
  return localStatus()
}

/** Whisper e o modelo de texto nunca rodam juntos: a transcrição local entra na mesma fila. */
export function exclusiveLocal<T>(fn: () => Promise<T>): Promise<T> {
  return engine.exclusive(fn)
}

export function initLocalAi(): void {
  setLocalRunner((modelId, fn) => {
    const s = getState()
    const bin = engineBinary(s)
    const m = modelById(modelId) ?? lightModel()
    // modelo médio apagado ou desligado: usa o leve
    const use = modelInstalled(m.id, s) ? m : lightModel()
    if (!bin || !modelInstalled(use.id, s)) throw new Error('IA no computador não instalada')
    return engine.run(
      { binary: bin, modelPath: modelPath(use.file), ctx: use.ctx, threads: engineThreads(), extraArgs: use.extraArgs },
      fn
    )
  })
  app.on('will-quit', () => engine.stop())
}
