import type { BusinessContext, BusinessContextField } from '@shared/types'
import { getSetting, setSetting } from '../db'
import { getAccount } from '../accounts'

/**
 * Contexto geral do negócio: o que a IA sabe da loja (por número de WhatsApp).
 * Fica no `settings` (chave `ai.context.<accountId>`), sem migração.
 * `businessContext` monta o texto que entra em todas as tarefas da IA, com limite de tamanho.
 */

/** Campos em ordem de prioridade: quando o texto passa do limite, os últimos são cortados primeiro. */
export const CONTEXT_FIELDS: Array<{ key: BusinessContextField; label: string }> = [
  { key: 'forbidden', label: 'O que a IA NÃO pode falar' },
  { key: 'about', label: 'O que a loja vende e para quem' },
  { key: 'products', label: 'Produtos e serviços (preço e prazo)' },
  { key: 'hours', label: 'Horário de funcionamento e endereço' },
  { key: 'payment', label: 'Formas de pagamento' },
  { key: 'policies', label: 'Troca, garantia e entrega' },
  { key: 'tone', label: 'Tom de voz' },
  { key: 'faq', label: 'Perguntas frequentes' }
]

/** Tamanho máximo de cada campo ao salvar. */
export const FIELD_MAX_CHARS = 4000
/** Tamanho padrão do contexto que vai para a IA (cerca de 1.300 tokens). */
export const CONTEXT_MAX_CHARS = 5000
/** Abaixo disso não vale a pena mandar um pedaço de campo cortado. */
const MIN_PIECE = 80

const EMPTY: BusinessContext = {
  about: '',
  products: '',
  hours: '',
  payment: '',
  policies: '',
  faq: '',
  tone: '',
  forbidden: '',
  updatedAt: null
}

const key = (accountId: string): string => `ai.context.${accountId}`

export function getBusinessContext(accountId: string): BusinessContext {
  const saved = getSetting<Partial<BusinessContext>>(key(accountId), {})
  const out: BusinessContext = { ...EMPTY, updatedAt: typeof saved.updatedAt === 'number' ? saved.updatedAt : null }
  for (const f of CONTEXT_FIELDS) out[f.key] = typeof saved[f.key] === 'string' ? (saved[f.key] as string) : ''
  return out
}

export function saveBusinessContext(accountId: string, patch: Partial<BusinessContext>): BusinessContext {
  const next = getBusinessContext(accountId)
  for (const f of CONTEXT_FIELDS) {
    const v = patch[f.key]
    if (typeof v === 'string') next[f.key] = v.replace(/\r\n/g, '\n').trim().slice(0, FIELD_MAX_CHARS)
  }
  next.updatedAt = Date.now()
  setSetting(key(accountId), next)
  return next
}

/** Corta no fim de uma linha ou palavra, sem passar de `max` (contando o "…"). */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const room = text.slice(0, max - 1)
  const at = Math.max(room.lastIndexOf('\n'), room.lastIndexOf(' '))
  return (at > max * 0.6 ? room.slice(0, at) : room).trimEnd() + '…'
}

/**
 * Texto do contexto para a IA (função pura para teste).
 * Campos vazios ficam de fora. Se passar de `maxChars`, corta pelos campos de menor prioridade.
 */
export function formatBusinessContext(storeName: string, ctx: BusinessContext, maxChars = CONTEXT_MAX_CHARS): string {
  let out = `Loja: ${storeName.trim() || 'Loja'}`.slice(0, maxChars)
  for (const f of CONTEXT_FIELDS) {
    const value = ctx[f.key]?.trim()
    if (!value) continue
    const head = `\n\n${f.label}:\n`
    const room = maxChars - out.length - head.length
    if (room >= value.length) {
      out += head + value
      continue
    }
    // Não cabe inteiro: entra um pedaço, se valer a pena, e os campos seguintes ficam de fora
    if (room >= MIN_PIECE) out += head + cut(value, room)
    break
  }
  return out
}

/** Contexto do negócio pronto para o prompt. Alimenta todas as tarefas da IA. */
export function businessContext(accountId: string, maxChars = CONTEXT_MAX_CHARS): string {
  const name = getAccount(accountId)?.name ?? 'Loja'
  return formatBusinessContext(name, getBusinessContext(accountId), maxChars)
}

/**
 * O que a IA pode AFIRMAR ao cliente: o contexto inteiro, menos o campo de proibições
 * (que fala do que não prometer e não pode liberar nada).
 */
export function allowedContext(accountId: string): string {
  const name = getAccount(accountId)?.name ?? 'Loja'
  return formatBusinessContext(name, { ...getBusinessContext(accountId), forbidden: '' }, 40_000)
}

/** Lê a resposta da IA (JSON, às vezes dentro de ```json) e devolve só os campos conhecidos. */
export function parseContextJson(text: string): Partial<BusinessContext> {
  const body = text.replace(/```(?:json)?/gi, '')
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('A IA não devolveu os campos. Tente de novo.')
  let raw: unknown
  try {
    raw = JSON.parse(body.slice(start, end + 1))
  } catch {
    throw new Error('A IA não devolveu os campos. Tente de novo.')
  }
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Partial<BusinessContext> = {}
  for (const f of CONTEXT_FIELDS) {
    const v = obj[f.key]
    const s = Array.isArray(v) ? v.map(String).join('\n') : typeof v === 'string' ? v : ''
    if (s.trim()) out[f.key] = s.trim().slice(0, FIELD_MAX_CHARS)
  }
  return out
}

export const FILL_SYSTEM = `Você organiza informações de um pequeno comércio brasileiro para um assistente de atendimento.
Responda somente com um objeto JSON, sem comentários, com estas chaves (todas texto em português do Brasil):
"about": o que a loja vende e para quem;
"products": produtos e serviços, um por linha, com preço e prazo quando aparecerem;
"hours": horário de funcionamento e endereço;
"payment": formas de pagamento;
"policies": políticas de troca, garantia e entrega;
"faq": perguntas frequentes, no formato "P: ... R: ...", uma por linha;
"tone": tom de voz da loja (como ela fala com os clientes);
"forbidden": o que o atendente não deve falar ou prometer.
Use só o que está no texto. Não invente preço, prazo, desconto, endereço ou telefone. Se não houver informação, deixe a chave com "".`
