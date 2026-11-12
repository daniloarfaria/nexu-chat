import { app } from 'electron'
import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { MediaInfo, TranscribeSettings, TranscribeStatus } from '@shared/types'
import { getDb, getSetting, setSetting } from '../db'
import { getAiSettings, listProviders } from '../ai/router'
import { exclusiveLocal, extract } from '../ai/local/service'
import { downloadVerified } from '../ai/local/download'
import { installVoiceComponents, isWhisperModel } from './voice-install'
import { voiceAssetsFor, WHISPER_MODEL } from './voice-catalog'
import { unsealString } from '../secure'
import { ensureMedia } from './media'
import { touchMessage } from './store'
import type { WASocket } from 'baileys'
import { log } from '../log'

/**
 * Transcrição de áudios e mensagens de voz com Whisper.
 * 1) Local (whisper.cpp + ffmpeg): o áudio não sai do computador.
 * 2) Groq (Whisper na nuvem): usa a chave cadastrada no Assistente de IA. O áudio é dado de cliente e não
 *    dá para anonimizar, então só sai do computador se a privacidade escolhida deixar (ver `groqState`).
 */

const run = promisify(execFile)
const DEFAULTS: TranscribeSettings = {
  mode: 'manual',
  engine: 'auto',
  whisperPath: null,
  modelPath: null,
  ffmpegPath: null
}

export function getTranscribeSettings(): TranscribeSettings {
  return { ...DEFAULTS, ...getSetting<Partial<TranscribeSettings>>('transcribe', {}) }
}

export function setTranscribeSettings(patch: Partial<TranscribeSettings>): TranscribeSettings {
  const next = { ...getTranscribeSettings(), ...patch }
  setSetting('transcribe', next)
  return next
}

const exe = process.platform === 'win32' ? '.exe' : ''

function firstExisting(paths: Array<string | null | undefined>): string | null {
  for (const p of paths) {
    if (!p) continue
    try {
      if (!statSync(p).isFile()) continue
      accessSync(p, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return p
    } catch {
      /* removido ou não executável */
    }
  }
  return null
}

function onPath(name: string): Array<string> {
  return (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').map((d) => join(d, name + exe))
}

function findModel(custom: string | null): string | null {
  if (custom && isWhisperModel(custom)) return custom
  const dirs = [
    join(app.getPath('userData'), 'models'),
    join(homedir(), '.cache', 'whisper'),
    join(homedir(), '.cache', 'marketing-melvin', 'modelos'),
    '/opt/homebrew/share/whisper-cpp/models',
    '/usr/local/share/whisper-cpp/models'
  ]
  // preferência: small > base > medium > tiny (equilíbrio entre qualidade e velocidade)
  const order = ['small', 'base', 'medium', 'large', 'tiny']
  for (const d of dirs) {
    if (!existsSync(d)) continue
    const files = readdirSync(d).filter((f) => /^ggml-.*\.bin$/.test(f))
    for (const o of order) {
      const f = files.find((x) => x.includes(o))
      if (f && isWhisperModel(join(d, f))) return join(d, f)
    }
  }
  return null
}

function localTools(s: TranscribeSettings): { whisper: string | null; model: string | null; ffmpeg: string | null } {
  return {
    whisper: firstExisting([
      s.whisperPath,
      '/opt/homebrew/bin/whisper-cli',
      '/usr/local/bin/whisper-cli',
      ...onPath('whisper-cli')
    ]),
    model: findModel(s.modelPath),
    ffmpeg: firstExisting([s.ffmpegPath, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', ...onPath('ffmpeg')])
  }
}

function bundledTool(name: 'whisper-cli' | 'ffmpeg'): string | null {
  const file = join('resources', 'transcribe', `darwin-${process.arch}`, name)
  return firstExisting([
    join(app.getAppPath?.() ?? process.cwd(), file).replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'),
    join(process.resourcesPath ?? '', 'transcribe', `darwin-${process.arch}`, name)
  ])
}

let installation: { abort: AbortController; job: Promise<void> } | null = null
let installProgress = { label: '', received: 0, total: 0, error: null as string | null }

function voiceInstallStatus(tools: ReturnType<typeof localTools>): TranscribeStatus['install'] {
  const assets = voiceAssetsFor(process.platform, process.arch)
  const supported =
    !!assets &&
    (process.platform !== 'darwin' ||
      ((!!tools.whisper || !!bundledTool('whisper-cli')) && (!!tools.ffmpeg || !!bundledTool('ffmpeg'))))
  return {
    ...installProgress,
    running: !!installation,
    supported,
    downloadBytes: !assets
      ? 0
      : (tools.ffmpeg ? 0 : (assets.ffmpeg?.size ?? 0)) +
        (tools.model ? 0 : WHISPER_MODEL.size) +
        (tools.whisper ? 0 : (assets.binary?.size ?? 0))
  }
}

/** Inicia em segundo plano; progresso fica disponível também ao sair e voltar para a tela. */
export function startVoiceInstall(): TranscribeStatus {
  if (installation) return transcribeStatus()
  const abort = new AbortController()
  const initialSettings = getTranscribeSettings()
  installProgress = { label: 'Preparando instalação', received: 0, total: 0, error: null }
  const job = Promise.resolve()
    .then(async () => {
      const tools = await installVoiceComponents({
        root: join(app.getPath('userData'), 'voice-local'),
        platform: process.platform,
        arch: process.arch,
        bundledWhisper: bundledTool('whisper-cli'),
        bundledFfmpeg: bundledTool('ffmpeg'),
        tools: localTools(initialSettings),
        signal: abort.signal,
        download: downloadVerified,
        extract,
        progress: (label, received, total) => {
          installProgress = { label, received, total, error: null }
        },
        validate: async (file, kind, signal) => {
          try {
            await run(file, [kind === 'whisper' ? '-h' : '-version'], {
              timeout: 20_000,
              windowsHide: true,
              signal,
              maxBuffer: 1024 * 1024
            })
          } catch (error) {
            if (signal.aborted) throw error
            throw new Error(
              process.platform === 'win32' && kind === 'whisper'
                ? 'O Windows não conseguiu iniciar o Whisper. Este pacote requer Microsoft Visual C++ Runtime x64. Nenhum caminho foi salvo; use as opções avançadas se já tiver outra instalação.'
                : `Não foi possível executar ${kind === 'whisper' ? 'o Whisper' : 'o conversor de áudio'}. Nenhum caminho foi salvo.`,
              { cause: error }
            )
          }
        }
      })
      abort.signal.throwIfAborted()
      // Não muda modo/provedor nem sobrescreve escolhas manuais feitas durante o download.
      const current = getTranscribeSettings()
      setTranscribeSettings({
        whisperPath: current.whisperPath !== initialSettings.whisperPath ? current.whisperPath : tools.whisper,
        ffmpegPath: current.ffmpegPath !== initialSettings.ffmpegPath ? current.ffmpegPath : tools.ffmpeg,
        modelPath: current.modelPath !== initialSettings.modelPath ? current.modelPath : tools.model
      })
      installProgress = { label: 'Voz pronta para usar', received: 0, total: 0, error: null }
    })
    .catch((error: unknown) => {
      installProgress = {
        label: abort.signal.aborted
          ? 'Instalação cancelada. Você pode retomar o download.'
          : 'Não foi possível concluir',
        received: 0,
        total: 0,
        error: abort.signal.aborted ? null : (error as Error).message
      }
    })
    .finally(() => {
      installation = null
    })
  installation = { abort, job }
  return transcribeStatus()
}

export function cancelVoiceInstall(): TranscribeStatus {
  installation?.abort.abort()
  return transcribeStatus()
}

type GroqBlocked = TranscribeStatus['groqBlocked']

/**
 * A Groq pode receber o áudio do cliente? Vale a mesma regra das conversas (`candidates` do roteador), mais
 * rígida porque áudio não é anonimizado: não vai se o provedor está marcado "sem conversas de clientes",
 * se ele pode treinar com os dados, ou se a privacidade é Estrita.
 */
function groqState(): { provider: { baseUrl: string; key: string } | null; blocked: GroqBlocked } {
  const p = listProviders().find((x) => x.preset === 'groq' && x.enabled && x.hasKey)
  if (!p) return { provider: null, blocked: null }
  if (p.noCustomerData) return { provider: null, blocked: 'sem-clientes' }
  if (getAiSettings().privacy === 'estrita') return { provider: null, blocked: 'estrita' }
  if (p.trainsOnData) return { provider: null, blocked: 'treina' }
  const row = getDb().prepare('SELECT base_url, api_key FROM ai_providers WHERE id = ?').get(p.id) as {
    base_url: string
    api_key: string
  }
  return { provider: { baseUrl: row.base_url, key: unsealString(row.api_key) }, blocked: null }
}

const BLOCKED_WHY: Record<Exclude<GroqBlocked, null>, string> = {
  'sem-clientes': 'a Groq está marcada para não receber conversas de clientes',
  estrita: 'a privacidade Estrita não deixa o áudio sair do computador',
  treina: 'a Groq está marcada como "pode treinar com os dados"'
}

export function transcribeStatus(): TranscribeStatus {
  const settings = getTranscribeSettings()
  const local = localTools(settings)
  const g = groqState()
  return {
    settings,
    install: voiceInstallStatus(local),
    local: { ...local, ready: !!(local.whisper && local.model && local.ffmpeg) },
    groq: !!g.provider,
    groqBlocked: g.blocked
  }
}

async function transcribeLocal(
  file: string,
  tools: { whisper: string; model: string; ffmpeg: string }
): Promise<string> {
  const wav = join(tmpdir(), `dsp-voz-${process.pid}-${Date.now()}.wav`)
  try {
    await run(
      tools.ffmpeg,
      [
        '-y',
        '-nostdin',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        file,
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        wav
      ],
      { timeout: 60_000 }
    )
    const { stdout } = await run(tools.whisper, ['-m', tools.model, '-f', wav, '-l', 'pt', '-nt', '-np', '-t', '4'], {
      timeout: 5 * 60_000,
      maxBuffer: 4 * 1024 * 1024
    })
    return stdout.replace(/\s+/g, ' ').trim()
  } finally {
    rmSync(wav, { force: true })
  }
}

async function transcribeGroq(file: string, mime: string, g: { baseUrl: string; key: string }): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([readFileSync(file)], { type: mime.split(';')[0] || 'audio/ogg' }), 'audio.ogg')
  form.append('model', 'whisper-large-v3-turbo')
  form.append('language', 'pt')
  form.append('response_format', 'text')
  const res = await fetch(`${g.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${g.key}` },
    body: form,
    // nunca segue redirecionamento: o áudio e a chave só vão para o endereço cadastrado
    redirect: 'error',
    signal: AbortSignal.timeout(120_000)
  })
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    throw new Error(res.status === 429 ? 'Limite da Groq atingido, tente mais tarde' : `Groq respondeu ${res.status}`)
  }
  return (await res.text()).replace(/\s+/g, ' ').trim()
}

// Um por vez: o Whisper local usa bastante CPU
let chain: Promise<unknown> = Promise.resolve()
const inflight = new Map<string, Promise<string>>()

export function transcribe(sock: WASocket | null, accountId: string, chatJid: string, id: string): Promise<string> {
  const key = `${accountId}|${chatJid}|${id}`
  const running = inflight.get(key)
  if (running) return running
  const job = async (): Promise<string> => {
    const row = getDb()
      .prepare('SELECT type, transcript, media FROM messages WHERE account_id = ? AND chat_jid = ? AND id = ?')
      .get(accountId, chatJid, id) as { type: string; transcript: string | null; media: string | null } | undefined
    if (!row) throw new Error('Mensagem não encontrada')
    if (row.type !== 'voice' && row.type !== 'audio' && row.type !== 'video')
      throw new Error('Só áudios e vídeos podem ser transcritos')
    if (row.transcript) return row.transcript
    const media = (await ensureMedia(sock, accountId, chatJid, id)) as MediaInfo & { file?: string }
    if (!media.file) throw new Error('Áudio indisponível')
    const file = join(app.getPath('userData'), 'media', accountId, media.file)
    const s = getTranscribeSettings()
    const tools = localTools(s)
    const localOk = tools.whisper && tools.model && tools.ffmpeg
    const { provider: g, blocked } = groqState()
    let text: string
    // "Só Groq" com a Groq barrada pela privacidade: usa o Whisper do computador, que é mais reservado
    if (localOk && (s.engine !== 'groq' || (!g && blocked))) {
      // nunca junto com o modelo de texto local: entra na fila dele e o desliga antes (memória baixa)
      text = await exclusiveLocal(() =>
        transcribeLocal(file, tools as { whisper: string; model: string; ffmpeg: string })
      )
    } else if ((s.engine === 'groq' || s.engine === 'auto') && g) {
      text = await transcribeGroq(file, media.mimetype ?? 'audio/ogg', g)
    } else if (blocked && s.engine !== 'local') {
      throw new Error(
        `Sem transcrição: ${BLOCKED_WHY[blocked]}. Instale o Whisper no computador (Configurações → Transcrição de áudio) para transcrever sem enviar o áudio para fora.`
      )
    } else {
      throw new Error(
        s.engine === 'local'
          ? 'Sem transcrição: o Whisper não está instalado neste computador (Configurações → Transcrição de áudio)'
          : 'Sem transcrição: instale o Whisper no computador ou cadastre a Groq no Assistente de IA'
      )
    }
    text = text.slice(0, 20_000) || '(sem fala reconhecida)'
    const db = getDb()
    db.prepare('UPDATE messages SET transcript = ? WHERE account_id = ? AND chat_jid = ? AND id = ?').run(
      text,
      accountId,
      chatJid,
      id
    )
    db.prepare('INSERT INTO messages_fts (text, account_id, chat_jid, id) VALUES (?, ?, ?, ?)').run(
      text,
      accountId,
      chatJid,
      id
    )
    touchMessage(accountId, chatJid, id)
    return text
  }
  // Só começa quando a anterior terminar
  const queued = chain.then(job, job)
  chain = queued.catch(() => undefined)
  inflight.set(key, queued)
  queued.finally(() => inflight.delete(key)).catch(() => undefined)
  return queued
}

/** Transcrição automática das mensagens de voz que chegam (se ligada). */
export function maybeAutoTranscribe(
  sock: WASocket | null,
  accountId: string,
  chatJid: string,
  id: string,
  type: string
): void {
  if (getTranscribeSettings().mode !== 'auto' || type !== 'voice') return
  transcribe(sock, accountId, chatJid, id).catch((e) =>
    log.warn('Transcrição automática falhou', { erro: (e as Error).message })
  )
}

/** Usado pelo playbook: transcreve as vozes que faltam numa conversa (até `max`). */
export async function transcribeMissing(
  sock: WASocket | null,
  accountId: string,
  chatJid: string,
  max = 15
): Promise<void> {
  if (getTranscribeSettings().mode === 'off') return
  const st = transcribeStatus()
  if (!st.local.ready && !st.groq) return
  const rows = getDb()
    .prepare(
      "SELECT id FROM messages WHERE account_id = ? AND chat_jid = ? AND type IN ('voice','audio') AND transcript IS NULL AND deleted = 0 ORDER BY ts DESC LIMIT ?"
    )
    .all(accountId, chatJid, max) as Array<{ id: string }>
  for (const r of rows) await transcribe(sock, accountId, chatJid, r.id).catch(() => undefined)
}
