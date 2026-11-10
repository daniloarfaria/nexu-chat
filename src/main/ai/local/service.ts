import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { HardwareInfo, LocalAiProgress, LocalAiStatus, LocalModelTier } from '@shared/types'
import { getSetting, setSetting } from '../../db'
import { log } from '../../log'
import { removeLocalProvider, setLocalRunner, upsertLocalProvider } from '../router'
import { ENGINE_VERSION, engineAssetFor, LOCAL_MODELS, lightModel, mediumModel, modelById } from './catalog'
import { clearPartial, downloadVerified, type DownloadOptions } from './download'
import { LocalEngine, realEngineDeps, type EngineDeps } from './engine'
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
const engineDir = (): string => join(baseDir(), 'engine', ENGINE_VERSION)
const runDir = (): string => join(baseDir(), 'run')
const pidFile = (): string => join(runDir(), 'motor.pid')
const modelPath = (file: string): string => join(baseDir(), 'models', file)
const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'

async function extract(archive: string, dest: string, signal: AbortSignal): Promise<void> {
  // tar do próprio sistema: no Mac (/usr/bin/tar) e no Windows 10+ (System32\tar.exe, também abre .zip).
  // Ele recusa caminhos absolutos e "..", então nada sai da pasta de destino.
  const tar =
    process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar'
  mkdirSync(dest, { recursive: true })
  // `signal`: "Remover IA local" durante a extração mata o tar
  await run(tar, ['-xf', archive, '-C', dest], { timeout: 120_000, windowsHide: true, signal })
  if (process.platform === 'darwin') {
    // arquivo conferido pelo SHA-256: tira a marca de "baixado da internet" para o macOS deixar rodar
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dest], { timeout: 30_000 }).catch(() => undefined)
  }
}

/** Caminho completo do programa de um PID (para só matar um llama-server nosso, nunca outro programa). */
async function processPath(pid: number): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${Math.trunc(pid)} -ErrorAction Stop).Path`],
        { timeout: 15_000, windowsHide: true }
      )
      return stdout.trim() || null
    }
    // No macOS, `comm=` já devolve o caminho completo do executável
    const { stdout } = await run('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 10_000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** Dependências trocáveis nos testes (download, extração, processo, computador). */
export const _deps = {
  download: (o: DownloadOptions): Promise<string> => downloadVerified(o),
  extract,
  engineDeps: realEngineDeps as EngineDeps,
  hardware: (): HardwareInfo => detectHardware(app.getPath('userData')),
  processPath,
  killPid: (pid: number): void => {
    process.kill(pid)
  },
  /** apagar com novas tentativas curtas (Windows: arquivo de processo que acabou de fechar) */
  remove: (path: string): Promise<void> => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

/** Apaga motor.pid só se ainda for o PID deste motor (um motor antigo que sai tarde não apaga o do novo). */
function releasePidFile(pid: number): void {
  try {
    if (readFileSync(pidFile(), 'utf8').trim() !== String(pid)) return
    rmSync(pidFile(), { force: true })
  } catch {
    /* arquivo já não existe */
  }
}
export const _releasePidFile = releasePidFile

let engine: LocalEngine | null = null
/** Só para testes: descarta o gerente do motor. */
export function _resetEngine(): void {
  engine = null
}
function getEngine(): LocalEngine {
  if (!engine) {
    const base = _deps.engineDeps
    engine = new LocalEngine({
      ...base,
      // guarda o PID: se o app cair, o próximo início encerra o motor que ficou para trás
      spawn: (spec, port, key) => {
        const child = base.spawn(spec, port, key)
        if (child.pid) {
          mkdirSync(runDir(), { recursive: true })
          writeFileSync(pidFile(), String(child.pid))
          const pid = child.pid
          child.onExit(() => releasePidFile(pid))
        }
        return child
      }
    })
  }
  return engine
}

let installing: { progress: LocalAiProgress; abort: AbortController; done: Promise<unknown> } | null = null

/** O motor só é aceito se estiver dentro de ai-local/engine/<versão>/ e tiver o nome certo. */
function engineBinary(s = getState()): string | null {
  if (!s.engineBinary || s.engineVersion !== ENGINE_VERSION) return null
  const root = resolve(engineDir())
  const p = resolve(baseDir(), s.engineBinary)
  if (!p.startsWith(root + sep) || basename(p) !== exeName) return null
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
  const hardware = _deps.hardware()
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
    running: engine?.running ?? false,
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

async function installEngine(signal: AbortSignal, progress: (p: LocalAiProgress) => void): Promise<void> {
  if (engineBinary()) return
  const asset = engineAssetFor(_deps.hardware().platform, _deps.hardware().arch)
  if (!asset) throw new Error('Este sistema ainda não tem a IA no computador')
  const archive = join(baseDir(), 'downloads', asset.file)
  await _deps.download({
    url: asset.url,
    dest: archive,
    sha256: asset.sha256,
    size: asset.size,
    signal,
    onProgress: (received, total) => progress({ stage: 'motor', label: 'Baixando o motor da IA', received, total })
  })
  progress({ stage: 'preparando', label: 'Preparando o motor', received: 0, total: 0 })
  const tmp = join(baseDir(), 'engine', `${ENGINE_VERSION}.tmp`)
  const final = engineDir()
  rmSync(tmp, { recursive: true, force: true })
  await _deps.extract(archive, tmp, signal)
  if (signal.aborted) throw new Error('Instalação cancelada')
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

async function installModel(id: string, signal: AbortSignal, progress: (p: LocalAiProgress) => void): Promise<void> {
  if (modelInstalled(id)) return
  const m = modelById(id)!
  await _deps.download({
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
  if (signal.aborted) throw new Error('Instalação cancelada')
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
  let last = 0
  const progress = (p: LocalAiProgress): void => {
    const changed = installing?.progress.stage !== p.stage
    if (installing) installing.progress = p
    // no máximo 4 avisos por segundo para a tela (o download chama a cada pedaço recebido)
    const now = Date.now()
    if (!changed && now - last < 250 && p.received < p.total) return
    last = now
    onProgress(p)
  }
  const work = (async (): Promise<void> => {
    await installEngine(ctrl.signal, progress)
    await installModel(lightModel().id, ctrl.signal, progress)
    if (tier === 'medio') {
      await installModel(mediumModel().id, ctrl.signal, progress)
      setState({ mediumEnabled: true })
    }
    registerProvider()
    log.info('IA no computador instalada', { nivel: tier, motor: ENGINE_VERSION })
  })()
  installing = {
    progress: { stage: 'motor', label: 'Começando', received: 0, total: 0 },
    abort: ctrl,
    done: work.catch(() => undefined)
  }
  try {
    await work
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

const LOCKED =
  'Não deu para apagar todos os arquivos da IA local: algum programa ainda está usando. Feche o Nexu Chat, abra de novo e tente outra vez.'

async function removePath(path: string): Promise<void> {
  try {
    await _deps.remove(path)
  } catch (e) {
    log.warn('Falha ao apagar arquivos da IA local', { erro: (e as Error).message })
    throw new Error(LOCKED, { cause: e })
  }
}

/** Desliga o modelo médio e apaga o arquivo dele (volta a usar só o leve). */
export async function disableMedium(): Promise<LocalAiStatus> {
  const m = mediumModel()
  // pela fila: espera a tarefa em andamento e o processo sair antes de apagar (Windows trava arquivo em uso)
  await getEngine().exclusive(async () => {
    try {
      await removePath(modelPath(m.file))
      clearPartial(modelPath(m.file))
    } finally {
      const s = getState()
      setState({ mediumEnabled: false, models: s.models.filter((x) => x !== m.id) })
      registerProvider()
    }
  })
  return localStatus()
}

/** Apaga a pasta da IA local inteira (motor, modelos e downloads pela metade) e o provedor. */
export async function removeLocal(): Promise<LocalAiStatus> {
  if (installing) {
    installing.abort.abort() // para o download ou mata o tar
    await installing.done
  }
  await getEngine().exclusive(async () => {
    try {
      await removePath(baseDir())
    } finally {
      // mesmo se algum arquivo ficou preso, o app para de usar a IA local
      setSetting('ai.local', DEFAULT)
      removeLocalProvider()
    }
  })
  return localStatus()
}

/** Whisper e o modelo de texto nunca rodam juntos: a transcrição local entra na mesma fila. */
export function exclusiveLocal<T>(fn: () => Promise<T>): Promise<T> {
  return getEngine().exclusive(fn)
}

/** O caminho completo é o llama-server desta instalação (dentro de ai-local/engine/<versão>/)? */
function isEngineExe(path: string): boolean {
  const ci = (x: string): string => (process.platform === 'win32' ? x.toLowerCase() : x)
  const p = ci(resolve(path))
  const root = ci(resolve(engineDir()))
  return p.startsWith(root + sep) && ci(basename(p)) === ci(exeName)
}

/** Motor que ficou rodando depois de o app cair: encerra, se for mesmo o llama-server. */
export async function killOrphan(): Promise<boolean> {
  const file = pidFile()
  if (!existsSync(file)) return false
  const pid = Number(readFileSync(file, 'utf8').trim())
  rmSync(file, { force: true })
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false
  const path = await _deps.processPath(pid)
  if (!path || !isEngineExe(path)) return false
  try {
    _deps.killPid(pid)
    log.info('Motor da IA local antigo encerrado', { pid })
    return true
  } catch {
    return false
  }
}

export function initLocalAi(): void {
  void killOrphan().catch(() => undefined)
  setLocalRunner(
    (modelId, fn) => {
      const s = getState()
      const bin = engineBinary(s)
      const m = modelById(modelId) ?? lightModel()
      // modelo médio apagado ou desligado: usa o leve
      const use = modelInstalled(m.id, s) ? m : lightModel()
      if (!bin || !modelInstalled(use.id, s)) throw new Error('IA no computador não instalada')
      return getEngine().run(
        {
          binary: bin,
          modelPath: modelPath(use.file),
          ctx: use.ctx,
          threads: engineThreads(),
          extraArgs: use.extraArgs,
          runDir: runDir()
        },
        fn
      )
    },
    (modelId) => {
      const m = modelById(modelId) ?? lightModel()
      return modelInstalled(m.id) ? m.ctx : lightModel().ctx
    }
  )
  let quitReady = false
  app.on('will-quit', (e) => {
    if (quitReady || !engine?.running) return
    // espera o motor sair de verdade antes de o app fechar
    e.preventDefault()
    void shutdownLocalAi().finally(() => {
      quitReady = true
      app.quit()
    })
  })
}

/** Encerramento do app (ou reinício): para o motor, espera sair e recusa tarefas novas. */
export async function shutdownLocalAi(): Promise<void> {
  await getEngine().shutdown()
}
