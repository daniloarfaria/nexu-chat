// Aniversário e datas do contato: funções puras (idade, dias que faltam, data dita na conversa).
import { fold, normalizeDate } from './rules'

export interface BirthdayInfo {
  /** 12/03 ou 12/03/1985 */
  label: string
  /** idade hoje; vazio quando o ano não é conhecido */
  age: number | null
  /** dias até a próxima data (0 = hoje) */
  daysUntil: number
}

const DAY = 86_400_000

function noon(y: number, m: number, d: number): number {
  return new Date(y, m, d, 12).getTime()
}

const isLeap = (y: number): boolean => new Date(y, 1, 29).getMonth() === 1

/** Dia do ano em que a data cai (29/02 em ano comum vira 28/02, como nos lembretes). */
function occurrence(year: number, month: number, day: number): number {
  const d = month === 1 && day === 29 && !isLeap(year) ? 28 : day
  return noon(year, month, d)
}

/** Idade e dias que faltam para a data (aniversário ou outra data anual). Aceita AAAA-MM-DD ou --MM-DD. */
export function birthdayInfo(raw: string | null | undefined, today = new Date()): BirthdayInfo | null {
  const norm = normalizeDate(raw)
  if (!norm) return null
  const m = /^(?:(\d{4})|-)-(\d{2})-(\d{2})$/.exec(norm)
  if (!m) return null
  const year = m[1] ? Number(m[1]) : null
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  const start = noon(today.getFullYear(), today.getMonth(), today.getDate())
  let next = occurrence(today.getFullYear(), month, day)
  if (next < start) next = occurrence(today.getFullYear() + 1, month, day)
  const daysUntil = Math.round((next - start) / DAY)
  let age: number | null = null
  if (year) {
    age = today.getFullYear() - year
    if (occurrence(today.getFullYear(), month, day) > start) age -= 1
    if (age < 0 || age > 130) age = null
  }
  const dd = String(day).padStart(2, '0')
  const mm = String(month + 1).padStart(2, '0')
  return { label: year ? `${dd}/${mm}/${year}` : `${dd}/${mm}`, age, daysUntil }
}

/** "hoje", "amanhã" ou "faltam 21 dias". */
export function untilLabel(days: number): string {
  if (days === 0) return 'hoje'
  if (days === 1) return 'amanhã'
  return `faltam ${days} dias`
}

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12
}

/** Frases em que a pessoa fala do próprio aniversário (não de outra pessoa, nem de retirada ou agendamento). */
const OWN =
  /(?:\bnasci\b|\bmeu (?:aniversario|niver|nascimento)\b|\bfaco anos\b|\bminha data de nascimento\b|\bminha data de nasc\b)/

/** Se aparece alguém além do cliente perto da frase, a data não é dele. */
const OTHER =
  /\b(marido|esposa|esposo|mulher|namorad[oa]|filh[oa]s?|mae|pai|irma[o]?|neto|neta|sobrinh[oa]|amig[oa]|colega|chefe|cunhad[oa]|genro|nora|dele|dela|dos dois)\b/

/** A data tem que estar logo depois da frase (até esta quantidade de letras). */
const NEAR = 45

/** Data que existe no calendário (31/02 não existe; 29/02 vale para qualquer ano). */
export function validDate(norm: string | null): string | null {
  const m = norm && /^(?:(\d{4})|-)-(\d{2})-(\d{2})$/.exec(norm)
  if (!m) return null
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(m[2]) - 1]
  if (Number(m[3]) > max) return null
  if (m[1] && Number(m[2]) === 2 && Number(m[3]) === 29 && !isLeap(Number(m[1]))) return null
  return norm
}

/**
 * Procura na fala do cliente a data do aniversário. Só aceita quando a frase é sobre ele mesmo
 * ("nasci em", "meu aniversário é", "faço anos"). Devolve AAAA-MM-DD ou --MM-DD, ou null.
 */
export function findBirthdayInText(text: string): string | null {
  const t = fold(text)
  const own = OWN.exec(t)
  if (!own) return null
  const rest = t.slice(own.index + own[0].length, own.index + own[0].length + NEAR)
  if (OTHER.test(rest)) return null
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(rest)
  if (iso) return validDate(normalizeDate(`${iso[1]}-${iso[2]}-${iso[3]}`))
  const num = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?\b/.exec(rest)
  if (num) return validDate(normalizeDate(`${num[1]}/${num[2]}${num[3] ? '/' + num[3] : ''}`))
  const ext = /\b(\d{1,2}) de ([a-z]+)(?: de (\d{4}))?\b/.exec(rest)
  if (ext && MONTHS[ext[2]]) return validDate(normalizeDate(`${ext[1]}/${MONTHS[ext[2]]}${ext[3] ? '/' + ext[3] : ''}`))
  return null
}
