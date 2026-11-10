import { NOTE_KINDS, type ContactNote, type NoteKind, type ProfileMapResult } from '@shared/types'
import { fold, normalizeDate } from '@shared/rules'
import { validDate } from '@shared/dates'
import { listAccounts, getAccount } from '../accounts'
import { log } from '../log'
import { listMessages } from '../wa/store'
import * as people from '../people'
import {
  AUTO_IDLE_SECONDS,
  AUTO_MIN_MESSAGES,
  autoProfileCandidates,
  chatJidsOf,
  listNotes,
  markProfiled,
  resolveTarget,
  saveAiNotes,
  storeBirthdayHint
} from '../notes'
import { complete } from './router'
import { anonymize } from './anonymize'
import { businessContext } from './context'

/**
 * Perfil do cliente pela IA: lê a conversa e propõe notas (preferências, objeções, família).
 * Regras: só o que ainda não existe, nunca dado de saúde (grau de óculos, doenças) nem outros dados sensíveis,
 * e o texto da conversa vai sempre anonimizado.
 */

const MAX_NEW_NOTES = 6

// ---------- Funções puras (testadas) ----------

export interface NoteDraft {
  kind: NoteKind
  title: string
  body: string
}

/** Lê a resposta da IA (JSON, às vezes dentro de ```json). */
export function parseProfileJson(text: string): { notes: NoteDraft[]; birthday: string | null } {
  const body = text.replace(/```(?:json)?/gi, '')
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('A IA não devolveu as notas. Tente de novo.')
  let raw: unknown
  try {
    raw = JSON.parse(body.slice(start, end + 1))
  } catch {
    throw new Error('A IA não devolveu as notas. Tente de novo.')
  }
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = Array.isArray(obj.notes) ? obj.notes : []
  const notes: NoteDraft[] = []
  for (const it of list) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const b = typeof o.body === 'string' ? o.body.trim() : ''
    if (!b) continue
    const kind = (NOTE_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as NoteKind) : 'geral'
    notes.push({ kind, title: typeof o.title === 'string' ? o.title.trim() : '', body: b })
  }
  const bd = typeof obj.birthday === 'string' ? validDate(normalizeDate(obj.birthday)) : null
  return { notes, birthday: bd }
}

const HEALTH =
  /\b(grau|graus|dioptria\w*|miopia|miope|astigmatismo|hipermetropia|presbiopia|vista cansada|catarata|glaucoma|ceratocone|receita medica|oftalmo\w*|diagnostic\w*|doenca\w*|diabet\w*|pressao alta|hipertens\w*|cancer|remedio\w*|medicament\w*|cirurgi\w*|laudo|exame\w*|deficien\w*|gravida\w*|gestante|depress\w*|ansiedade|psiquiatr\w*|hiv|esf|cil|eixo|adicao)\b/
const SENSITIVE_OTHER =
  /\b(religi\w*|evangelic\w*|catolic\w*|espirita|umbanda|candomble|ateu|ateia|partido|politic\w*|bolsonar\w*|lula|homossexual|gay|lesbica|orientacao sexual|etnia|raca)\b/
const DEGREE = /(?<![\w.,])[+-]\d{1,2}[.,]\d{2}\b/

/** O texto fala de saúde (grau de óculos, doença, remédio) ou de outro dado sensível? Então não vira nota. */
export function isSensitive(text: string): boolean {
  const t = fold(text)
  return HEALTH.test(t) || SENSITIVE_OTHER.test(t) || DEGREE.test(text)
}

const STOP = new Set([
  'a',
  'o',
  'as',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'um',
  'uma',
  'para',
  'pra',
  'com',
  'que',
  'na',
  'no'
])

function tokens(s: string): Set<string> {
  return new Set(
    fold(s)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
  )
}

/** A nota repete uma que já existe (mesmo escrita de outro jeito)? */
export function isDuplicateNote(
  cand: { title: string; body: string },
  existing: Array<{ title: string; body: string }>
): boolean {
  const a = tokens(cand.body)
  if (!a.size) return true
  for (const e of existing) {
    const b = tokens(e.body)
    if (!b.size) continue
    let inter = 0
    for (const w of a) if (b.has(w)) inter++
    const union = a.size + b.size - inter
    const small = Math.min(a.size, b.size)
    if (inter / union >= 0.6 || (small >= 2 && inter === small)) return true
  }
  return false
}

/**
 * Do que a IA devolveu, fica só o que serve: sem dado sensível, sem marcador de dado pessoal,
 * sem repetir nota existente nem repetir entre si, no máximo `MAX_NEW_NOTES`.
 */
export function buildProfileNotes(cands: NoteDraft[], existing: Array<{ title: string; body: string }>): NoteDraft[] {
  const kept: NoteDraft[] = []
  const known = [...existing]
  for (const c of cands) {
    const fix = (s: string): string =>
      s
        .replace(/\[cliente\]/gi, 'o cliente')
        .replace(/\s+/g, ' ')
        .trim()
    const title = fix(c.title)
    const body = fix(c.body)
    if (!body) continue
    if (/\[[a-zç]+\]/i.test(body) || /\[[a-zç]+\]/i.test(title)) continue // sobrou telefone, e-mail, endereço...
    if (isSensitive(`${title} ${body}`)) continue
    if (isDuplicateNote({ title, body }, known)) continue
    kept.push({ kind: c.kind, title, body })
    known.push({ title, body })
    if (kept.length >= MAX_NEW_NOTES) break
  }
  return kept
}

/**
 * Notas do cliente para o contexto da IA (sugestão de resposta, robô, acompanhamento), anonimizadas.
 * As fixadas vêm primeiro. Vazio quando não há notas.
 */
export function notesForPrompt(
  notes: Array<{ title: string; body: string; pinned?: boolean; kind?: string }>,
  names: string[] = [],
  maxChars = 1500
): string {
  if (!notes.length) return ''
  const sorted = [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
  let out = ''
  for (const n of sorted) {
    const line = `- ${anonymize(`${n.title}: ${n.body}`, names)}\n`
    if (out.length + line.length > maxChars) break
    out += line
  }
  return out ? `Notas da loja sobre este cliente:\n${out.trimEnd()}` : ''
}

/** Conversa parada há 2 horas com pelo menos 10 mensagens novas? */
export function dueForAutoProfile(c: { lastTs: number; newMessages: number }, nowSec: number): boolean {
  return nowSec - c.lastTs >= AUTO_IDLE_SECONDS && c.newMessages >= AUTO_MIN_MESSAGES
}

// ---------- Mapeamento ----------

export const PROFILE_SYSTEM = `Você ajuda uma loja a lembrar de cada cliente. Leia a conversa de WhatsApp e anote o que ajuda a atender melhor da próxima vez.
Responda somente com um objeto JSON, sem comentários:
{"notes":[{"kind":"...","title":"...","body":"..."}],"birthday":null}
"kind" é um destes: "perfil" (como o cliente é e o que busca), "preferencia" (gostos, estilo, orçamento), "objecao" (o que o fez hesitar, como "achou caro"), "familia" (para quem compra, quem decide), "geral".
"title" tem até 5 palavras. "body" é uma frase curta e direta, em português do Brasil.
Regras:
- Anote só o que o cliente disse ou deixou claro. Não invente, não deduza.
- NUNCA anote saúde: grau ou receita de óculos, doenças, remédios, exames, nem religião, política ou vida íntima.
- Não anote telefone, endereço, CPF nem outros dados pessoais.
- Não repita o que já está nas notas existentes; se não há nada novo, devolva "notes": [].
- No máximo ${MAX_NEW_NOTES} notas.
- "birthday": só se o próprio cliente disser a data do aniversário dele (formato "DD/MM" ou "DD/MM/AAAA"); senão null.`

const inFlight = new Set<string>()

/**
 * Lê a conversa do contato e salva as notas novas, marcadas "IA".
 * Só propõe o que ainda não existe. O aniversário achado fica como sugestão (não é salvo no contato).
 */
export async function mapProfile(
  accountId: string,
  target: { personId?: number; chatJid?: string }
): Promise<ProfileMapResult> {
  const personId = resolveTarget(accountId, target, true)!
  const key = `${accountId}:${personId}`
  if (inFlight.has(key)) throw new Error('A IA já está lendo esta conversa. Aguarde um instante.')
  inFlight.add(key)
  try {
    const person = people.getPerson(accountId, personId)!
    const jids = target.chatJid ? [target.chatJid] : chatJidsOf(accountId, personId)
    const msgs = jids
      .flatMap((j) => listMessages(accountId, j, null, 60))
      .filter((m) => m.type !== 'system' && !m.deleted && (m.text || m.transcript))
      .sort((a, b) => a.ts - b.ts)
      .slice(-60)
    if (!msgs.length) throw new Error('Esta conversa ainda não tem mensagens')
    const lastTs = msgs[msgs.length - 1].ts
    // Poucas falas do cliente: não vale gastar a IA. Marca como lida para não tentar de novo.
    if (msgs.filter((m) => !m.fromMe).length < 3) {
      markProfiled(accountId, personId, lastTs)
      return { added: [], birthday: null }
    }
    const names = [person.name ?? ''].filter(Boolean)
    const store = getAccount(accountId)?.name ?? 'Loja'
    const convo = msgs
      .map((m) => anonymize(`${m.fromMe ? store : 'Cliente'}: ${m.text ?? `[áudio] ${m.transcript}`}`, names))
      .join('\n')
    const existing = listNotes(accountId, personId)
    const have = existing.length
      ? existing.map((n: ContactNote) => `- ${anonymize(`${n.title}: ${n.body}`, names)}`).join('\n')
      : '(nenhuma)'
    const r = await complete({
      task: 'perfil_cliente',
      tier: 'fast', // extração simples: a IA no computador primeiro
      customerData: true,
      system: `${PROFILE_SYSTEM}\n\nContexto da loja:\n${businessContext(accountId, 2500)}`,
      prompt: `Notas que já existem:\n${have}\n\nConversa (mais antiga primeiro):\n${convo}\n\nDevolva o JSON.`,
      maxTokens: 900
    })
    const parsed = parseProfileJson(r.text)
    const added = saveAiNotes(accountId, personId, buildProfileNotes(parsed.notes, existing))
    markProfiled(accountId, personId, lastTs)
    if (parsed.birthday && !person.birthday) storeBirthdayHint(accountId, personId, parsed.birthday)
    return { added, birthday: !person.birthday ? parsed.birthday : null }
  } finally {
    inFlight.delete(key)
  }
}

// ---------- Disparo automático ----------

const RETRY_AFTER_MS = 60 * 60_000
const failedAt = new Map<string, number>()

/** Uma rodada: contas com a função ligada, conversas paradas há 2 h com 10 mensagens novas. */
export async function runAutoProfiles(nowSec = Math.floor(Date.now() / 1000)): Promise<number> {
  let done = 0
  for (const a of listAccounts()) {
    if (!a.modules.perfilIa) continue
    for (const c of autoProfileCandidates(a.id, nowSec)) {
      if (!dueForAutoProfile(c, nowSec)) continue
      const k = `${a.id}:${c.personId}`
      if (Date.now() - (failedAt.get(k) ?? 0) < RETRY_AFTER_MS) continue
      try {
        await mapProfile(a.id, { personId: c.personId })
        done++
      } catch (e) {
        failedAt.set(k, Date.now())
        log.warn('Perfil do cliente pela IA falhou', { erro: (e as Error).message })
      }
    }
  }
  return done
}

export function startProfileAuto(): void {
  setTimeout(() => void runAutoProfiles(), 3 * 60_000)
  setInterval(() => void runAutoProfiles(), 10 * 60_000)
}
