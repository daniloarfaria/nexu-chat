import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { MediaInfo, TranscribeSettings, TranscribeStatus } from '@shared/types'
import { getDb, getSetting, setSetting } from '../db'
import { listProviders } from '../ai/router'
import { unsealString } from '../secure'
import { ensureMedia } from './media'
import { touchMessage } from './store'
import type { WASocket } from 'baileys'
import { log } from '../log'

/**
 * Transcrição de áudios e mensagens de voz com Whisper.
 * 1) Local (whisper.cpp + ffmpeg): o áudio não sai do computador.
 * 2) Groq (Whisper na nuvem, gratuito, não treina com os dados): usa a chave cadastrada no Assistente de IA.
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
  for (const p of paths) if (p && existsSync(p)) return p
  return null
}

function onPath(name: string): Array<string> {
  return (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').map((d) => join(d, name + exe))
}

function findModel(custom: string | null): string | null {
  if (custom && existsSync(custom)) return custom
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
      if (f) return join(d, f)
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

function groqProvider(): { baseUrl: string; key: string } | null {
  const p = listProviders().find((x) => x.preset === 'groq' && x.enabled && x.hasKey)
  if (!p) return null
  const row = getDb().prepare('SELECT base_url, api_key FROM ai_providers WHERE id = ?').get(p.id) as {
    base_url: string
    api_key: string
  }
  return { baseUrl: row.base_url, key: unsealString(row.api_key) }
}

export function transcribeStatus(): TranscribeStatus {
  const settings = getTranscribeSettings()
  const local = localTools(settings)
  return {
    settings,
    local: { ...local, ready: !!(local.whisper && local.model && local.ffmpeg) },
    groq: !!groqProvider()
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
      ['-y', '-loglevel', 'error', '-i', file, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
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
    const g = groqProvider()
    let text: string
    if ((s.engine === 'local' || s.engine === 'auto') && localOk) {
      text = await transcribeLocal(file, tools as { whisper: string; model: string; ffmpeg: string })
    } else if ((s.engine === 'groq' || s.engine === 'auto') && g) {
      text = await transcribeGroq(file, media.mimetype ?? 'audio/ogg', g)
    } else {
      throw new Error(
        'Transcrição indisponível: instale o Whisper no computador ou cadastre a Groq no Assistente de IA'
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
