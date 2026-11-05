import type { AntiBanSettings } from './types'

// ---------- Telefone ----------

/**
 * Normaliza telefone para dígitos com DDI. Brasil por padrão.
 * "(11) 98765-4321" → "5511987654321"; "011 98765 4321" → "5511987654321"; "+1 415 555 0100" → "14155550100"
 * Retorna null se não parecer um telefone válido.
 */
export function normalizePhone(raw: unknown): string | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  // Números do Excel às vezes vêm como 5.511987654321E12
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) s = Number(s).toFixed(0)
  const intl = s.startsWith('+')
  let d = s.replace(/\D/g, '')
  if (!d) return null
  if (intl) return d.length >= 10 && d.length <= 15 ? d : null
  d = d.replace(/^0+/, '')
  // Prefixo de operadora: 0 + operadora(2) + DDD + número (ex.: 0 15 11 987654321)
  if ((d.length === 12 || d.length === 13) && !d.startsWith('55')) d = d.slice(2)
  if (d.length === 10 || d.length === 11) d = '55' + d
  if (!d.startsWith('55')) return d.length >= 10 && d.length <= 15 ? d : null
  if (d.length !== 12 && d.length !== 13) return null
  const ddd = Number(d.slice(2, 4))
  if (ddd < 11 || ddd > 99) return null
  return d
}

// ---------- Datas ----------

/** Aceita 31/12/1990, 31/12, 1990-12-31, número de série do Excel. Retorna AAAA-MM-DD ou --MM-DD. */
export function normalizeDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw.toISOString().slice(0, 10)
  const s = String(raw).trim()
  let m = /^--(\d{2})-(\d{2})$/.exec(s) // aniversário sem ano (formato interno)
  if (m) return valid(null, +m[1], +m[2])
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s)
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? (+m[3] > 30 ? 1900 : 2000) + +m[3] : +m[3]) : null
    return valid(y, +m[2], +m[1])
  }
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000)
    return d.toISOString().slice(0, 10)
  }
  return null
}

function valid(y: number | null, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const mm = String(mo).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  return y ? `${y}-${mm}-${dd}` : `--${mm}-${dd}`
}

// ---------- Modelos de mensagem ----------

export const OPT_OUT_FOOTER = 'Se não quiser mais receber nossas mensagens, responda SAIR.'

/** Remove acentos e deixa minúsculo, para comparar textos. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

/**
 * Monta a mensagem final:
 * - {nome}, {primeiro_nome}, {loja} e qualquer campo do contato: {cidade}
 * - variação de texto (spintax): {Oi|Olá|E aí}, pode aninhar
 * Variáveis ausentes somem sem deixar "{campo}" na mensagem.
 */
export function renderTemplate(
  tpl: string,
  vars: Record<string, string | null | undefined>,
  rnd = Math.random
): string {
  const folded = Object.fromEntries(Object.entries(vars).map(([k, v]) => [fold(k).replace(/\s+/g, '_'), v ?? '']))
  let out = tpl
  // Spintax de dentro para fora
  for (let i = 0; i < 10 && /\{[^{}]*\|[^{}]*\}/.test(out); i++) {
    out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, body: string) => {
      const opts = body.split('|')
      return opts[Math.floor(rnd() * opts.length)]
    })
  }
  out = out.replace(/\{\s*([\p{L}\d_ ]+?)\s*\}/gu, (_whole, key: string) => {
    const k = fold(key).replace(/\s+/g, '_')
    return k in folded ? folded[k] : ''
  })
  return out
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function firstName(name: string | null | undefined): string {
  if (!name) return ''
  const first = name.trim().split(/\s+/)[0] ?? ''
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

export function hasLink(text: string): boolean {
  return /(https?:\/\/|www\.|\b[\w-]+\.(com|com\.br|net|br|ly|me|io)\b)/i.test(text)
}

/** Palavras que significam "não quero mais receber". */
const OPT_OUT_WORDS = [
  'sair',
  'parar',
  'pare',
  'stop',
  'cancelar',
  'descadastrar',
  'remover',
  'nao quero',
  'não quero mais'
]
export function isOptOut(text: string | null | undefined): boolean {
  if (!text) return false
  const t = fold(text)
    .replace(/[^\p{L}\s]/gu, '')
    .trim()
  if (t.length > 40) return false
  return (
    OPT_OUT_WORDS.some((w) => t === fold(w) || t.startsWith(fold(w) + ' ')) || /^(me )?(tira|remove) da lista/.test(t)
  )
}

// ---------- Anti-bloqueio ----------

export const DEFAULT_ANTIBAN: AntiBanSettings = {
  minDelay: 60,
  maxDelay: 180,
  pauseEvery: 18,
  pauseMin: 10,
  pauseMax: 20,
  dailyLimit: 200,
  hourStart: 9,
  hourEnd: 19,
  days: [1, 2, 3, 4, 5, 6],
  typing: true,
  warmup: false,
  warmupStartedAt: null,
  minReplyRate: 0,
  maxFailStreak: 5
}

/** Limite do dia considerando o aquecimento de número novo (20 no 1º dia, +15 por dia). */
export function effectiveDailyLimit(s: AntiBanSettings, now = Date.now()): number {
  if (!s.warmup || !s.warmupStartedAt) return s.dailyLimit
  const days = Math.max(0, Math.floor((now - s.warmupStartedAt) / 86_400_000))
  return Math.min(s.dailyLimit, 20 + days * 15)
}

/** Dentro da janela de envio? Se não, devolve quando ela abre. */
export function sendWindow(s: AntiBanSettings, now = new Date()): { open: boolean; opensAt: number | null } {
  const inDay = s.days.includes(now.getDay())
  const h = now.getHours()
  if (inDay && h >= s.hourStart && h < s.hourEnd) return { open: true, opensAt: null }
  // procura o próximo dia/hora permitido
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    d.setHours(s.hourStart, 0, 0, 0)
    if (s.days.includes(d.getDay()) && d.getTime() > now.getTime()) return { open: false, opensAt: d.getTime() }
  }
  return { open: false, opensAt: null }
}

export function randomBetween(min: number, max: number, rnd = Math.random): number {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return lo + rnd() * (hi - lo)
}

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
