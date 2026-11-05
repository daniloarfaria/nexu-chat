import Anthropic from '@anthropic-ai/sdk'
import type { AiPreset, AiProvider, AiSettings } from '@shared/types'
import { getDb, getSetting, setSetting } from '../db'
import { sealString, unsealString } from '../secure'
import { dayKey } from '@shared/rules'
import { log } from '../log'

/**
 * Roteador de modelos de IA.
 * - Provedores gratuitos (Groq, Gemini, OpenRouter, Mistral, Ollama…) via API no formato OpenAI.
 * - Claude como reserva paga, via SDK oficial da Anthropic.
 * Escolhe pela tarefa, respeita limites por minuto/dia e passa para o próximo quando um falha.
 */

export const PRESETS: Record<
  Exclude<AiPreset, 'custom'>,
  {
    name: string
    baseUrl: string
    fast: string
    smart: string
    trains: boolean
    rpm: number | null
    rpd: number | null
    paid: boolean
    keyUrl: string
  }
> = {
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    fast: 'openai/gpt-oss-20b',
    smart: 'openai/gpt-oss-120b',
    trains: false,
    rpm: 30,
    rpd: 1000,
    paid: false,
    keyUrl: 'https://console.groq.com/keys'
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    fast: 'gemini-3.5-flash-lite',
    smart: 'gemini-3.8-flash',
    trains: true, // plano gratuito fora da Europa pode usar os dados
    rpm: 10,
    rpd: 250,
    paid: false,
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  openrouter: {
    name: 'OpenRouter (modelos :free)',
    baseUrl: 'https://openrouter.ai/api/v1',
    fast: 'google/gemma-4-31b-it:free',
    smart: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    trains: true,
    rpm: 20,
    rpd: 50,
    paid: false,
    keyUrl: 'https://openrouter.ai/keys'
  },
  mistral: {
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    fast: 'mistral-medium-3-5',
    smart: 'mistral-medium-3-5',
    trains: true, // modo gratuito treina, a menos que desative na conta
    rpm: 60,
    rpd: null,
    paid: false,
    keyUrl: 'https://console.mistral.ai/api-keys'
  },
  ollama: {
    name: 'Ollama (no computador)',
    baseUrl: 'http://localhost:11434/v1',
    fast: 'llama3.2',
    smart: 'llama3.2',
    trains: false,
    rpm: null,
    rpd: null,
    paid: false,
    keyUrl: 'https://ollama.com/download'
  },
  claude: {
    name: 'Claude (Anthropic) — pago',
    baseUrl: 'https://api.anthropic.com',
    fast: 'claude-opus-5-5',
    smart: 'claude-opus-5-5',
    trains: false,
    rpm: null,
    rpd: null,
    paid: true,
    keyUrl: 'https://platform.claude.com/settings/keys'
  }
}

export type Tier = 'fast' | 'smart'

export interface AiRequest {
  task: string
  tier: Tier
  system: string
  prompt: string
  customerData: boolean
  maxTokens?: number
  premium?: boolean // pode usar provedor pago mesmo com gratuitos disponíveis
}

interface Row {
  id: number
  preset: AiPreset
  name: string
  base_url: string
  api_key: string | null
  model_fast: string | null
  model_smart: string | null
  trains_on_data: number
  rpm: number | null
  rpd: number | null
  paid: number
  enabled: number
  priority: number
  cooldown_until: number
}

export function getAiSettings(): AiSettings {
  return { privacy: 'anonimizar', paidMonthlyLimit: 300, ...getSetting<Partial<AiSettings>>('ai', {}) }
}

export function setAiSettings(patch: Partial<AiSettings>): AiSettings {
  const next = { ...getAiSettings(), ...patch }
  setSetting('ai', next)
  return next
}

function usage(id: number): { requests: number; errors: number } {
  const r = getDb()
    .prepare('SELECT requests, errors FROM ai_usage WHERE provider_id = ? AND day = ?')
    .get(id, dayKey()) as { requests: number; errors: number } | undefined
  return r ?? { requests: 0, errors: 0 }
}

export function listProviders(): AiProvider[] {
  return (getDb().prepare('SELECT * FROM ai_providers ORDER BY paid, priority, id').all() as unknown as Row[]).map(
    (r) => {
      const u = usage(r.id)
      return {
        id: r.id,
        preset: r.preset,
        name: r.name,
        baseUrl: r.base_url,
        hasKey: !!r.api_key,
        modelFast: r.model_fast ?? '',
        modelSmart: r.model_smart ?? '',
        trainsOnData: !!r.trains_on_data,
        rpm: r.rpm,
        rpd: r.rpd,
        paid: !!r.paid,
        enabled: !!r.enabled,
        priority: r.priority,
        usedToday: u.requests,
        errorsToday: u.errors,
        cooldownUntil: r.cooldown_until
      }
    }
  )
}

export function saveProvider(p: {
  id?: number
  preset: AiPreset
  name?: string
  baseUrl?: string
  apiKey?: string | null
  modelFast?: string
  modelSmart?: string
  trainsOnData?: boolean
  enabled?: boolean
  priority?: number
}): AiProvider {
  const db = getDb()
  const preset = p.preset !== 'custom' ? PRESETS[p.preset] : null
  const baseUrl = (p.baseUrl ?? preset?.baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('Endereço da API inválido')
  if (/^http:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(baseUrl)) {
    throw new Error('Use https (http só é aceito para modelos no próprio computador)')
  }
  const key = p.apiKey === undefined ? undefined : p.apiKey ? sealString(p.apiKey.trim()) : null
  if (p.id) {
    const cur = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(p.id) as unknown as Row | undefined
    if (!cur) throw new Error('Provedor não encontrado')
    db.prepare(
      `UPDATE ai_providers SET name = ?, base_url = ?, api_key = ?, model_fast = ?, model_smart = ?, trains_on_data = ?, enabled = ?, priority = ?, cooldown_until = 0 WHERE id = ?`
    ).run(
      p.name ?? cur.name,
      baseUrl,
      key === undefined ? cur.api_key : key,
      p.modelFast ?? cur.model_fast,
      p.modelSmart ?? cur.model_smart,
      p.trainsOnData === undefined ? cur.trains_on_data : p.trainsOnData ? 1 : 0,
      p.enabled === undefined ? cur.enabled : p.enabled ? 1 : 0,
      p.priority ?? cur.priority,
      p.id
    )
    return listProviders().find((x) => x.id === p.id)!
  }
  const id = db
    .prepare(
      `INSERT INTO ai_providers (preset, name, base_url, api_key, model_fast, model_smart, trains_on_data, rpm, rpd, paid, enabled, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      p.preset,
      p.name ?? preset?.name ?? 'Provedor',
      baseUrl,
      key ?? null,
      p.modelFast ?? preset?.fast ?? '',
      p.modelSmart ?? preset?.smart ?? p.modelFast ?? '',
      (p.trainsOnData ?? preset?.trains ?? true) ? 1 : 0,
      preset?.rpm ?? null,
      preset?.rpd ?? null,
      preset?.paid ? 1 : 0,
      p.priority ?? 100,
      Date.now()
    ).lastInsertRowid
  return listProviders().find((x) => x.id === Number(id))!
}

export function deleteProvider(id: number): void {
  getDb().prepare('DELETE FROM ai_providers WHERE id = ?').run(id)
}

// ---------- Chamada ----------

const minuteWindow = new Map<number, number[]>()

function underRpm(p: AiProvider): boolean {
  if (!p.rpm) return true
  const now = Date.now()
  const list = (minuteWindow.get(p.id) ?? []).filter((t) => now - t < 60_000)
  minuteWindow.set(p.id, list)
  return list.length < p.rpm
}

function paidThisMonth(): number {
  const month = dayKey().slice(0, 7)
  const r = getDb()
    .prepare(
      `SELECT COALESCE(SUM(u.requests), 0) AS n FROM ai_usage u JOIN ai_providers p ON p.id = u.provider_id WHERE p.paid = 1 AND u.day LIKE ?`
    )
    .get(`${month}%`) as { n: number }
  return r.n
}

function track(id: number, ok: boolean, tokens = 0): void {
  getDb()
    .prepare(
      `INSERT INTO ai_usage (provider_id, day, requests, tokens, errors) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT DO UPDATE SET requests = requests + 1, tokens = tokens + excluded.tokens, errors = errors + excluded.errors`
    )
    .run(id, dayKey(), tokens, ok ? 0 : 1)
}

function cooldown(id: number, ms: number): void {
  getDb()
    .prepare('UPDATE ai_providers SET cooldown_until = ? WHERE id = ?')
    .run(Date.now() + ms, id)
}

class ProviderError extends Error {
  constructor(
    message: string,
    public retryAfterMs: number | null,
    public fatal = false
  ) {
    super(message)
  }
}

async function callOpenAiCompatible(p: Row, model: string, req: AiRequest): Promise<{ text: string; tokens: number }> {
  const key = p.api_key ? unsealString(p.api_key) : ''
  const res = await fetch(`${p.base_url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 2000,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt }
      ]
    }),
    signal: AbortSignal.timeout(90_000)
  })
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300)
    const ra = Number(res.headers.get('retry-after'))
    if (res.status === 429)
      throw new ProviderError(`limite atingido (${body})`, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000)
    if (res.status === 401 || res.status === 403)
      throw new ProviderError('chave inválida ou sem permissão', 6 * 3600_000, true)
    if (res.status >= 500) throw new ProviderError(`erro do servidor ${res.status}`, 30_000)
    throw new ProviderError(`erro ${res.status}: ${body}`, 5 * 60_000)
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { total_tokens?: number }
  }
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) throw new ProviderError('resposta vazia', 30_000)
  return { text, tokens: json.usage?.total_tokens ?? 0 }
}

async function callClaude(p: Row, model: string, req: AiRequest): Promise<{ text: string; tokens: number }> {
  const client = new Anthropic({ apiKey: unsealString(p.api_key ?? ''), maxRetries: 1, timeout: 120_000 })
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: req.maxTokens ?? 16000,
      // fallback automático do servidor caso o modelo recuse por política
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: req.tier === 'fast' ? 'low' : 'medium' },
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }]
    })
    if (response.stop_reason === 'refusal') throw new ProviderError('o modelo recusou o pedido', 0)
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (!text) throw new ProviderError('resposta vazia', 30_000)
    return { text, tokens: response.usage.input_tokens + response.usage.output_tokens }
  } catch (e) {
    if (e instanceof ProviderError) throw e
    if (e instanceof Anthropic.RateLimitError) throw new ProviderError('limite atingido', 60_000)
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      throw new ProviderError('chave inválida ou sem permissão', 6 * 3600_000, true)
    if (e instanceof Anthropic.BadRequestError) throw new ProviderError(`pedido recusado: ${e.message}`, 5 * 60_000)
    if (e instanceof Anthropic.APIError) throw new ProviderError(`erro ${e.status ?? ''}`, 30_000)
    throw new ProviderError((e as Error).message, 30_000)
  }
}

/** Ordem de tentativa para um pedido (função pura para teste). */
export function candidates(
  providers: AiProvider[],
  req: Pick<AiRequest, 'customerData' | 'premium'>,
  s: AiSettings,
  paidUsed: number,
  now = Date.now()
): AiProvider[] {
  const usable = providers.filter(
    (p) =>
      p.enabled &&
      (p.hasKey || p.preset === 'ollama') &&
      p.cooldownUntil <= now &&
      (!p.rpd || p.usedToday < p.rpd) &&
      // dados de clientes: no modo estrito, só provedores que não treinam com os dados
      !(req.customerData && s.privacy === 'estrita' && p.trainsOnData) &&
      !(p.paid && paidUsed >= s.paidMonthlyLimit)
  )
  const free = usable
    .filter((p) => !p.paid)
    .sort((a, b) => a.priority - b.priority || Number(a.trainsOnData) - Number(b.trainsOnData))
  const paid = usable.filter((p) => p.paid)
  return req.premium ? [...paid, ...free] : [...free, ...paid]
}

export async function complete(req: AiRequest): Promise<{ text: string; provider: string; model: string }> {
  const settings = getAiSettings()
  const list = candidates(listProviders(), req, settings, paidThisMonth())
  if (!list.length) {
    throw new Error(
      'Nenhum provedor de IA disponível. Cadastre uma chave em Assistente de IA → Provedores (Groq e Gemini têm plano gratuito).'
    )
  }
  const errors: string[] = []
  for (const p of list) {
    if (!underRpm(p)) {
      errors.push(`${p.name}: limite por minuto`)
      continue
    }
    const row = getDb().prepare('SELECT * FROM ai_providers WHERE id = ?').get(p.id) as unknown as Row
    const model = (req.tier === 'fast' ? row.model_fast : row.model_smart) || row.model_fast || row.model_smart || ''
    const win = minuteWindow.get(p.id) ?? []
    win.push(Date.now())
    minuteWindow.set(p.id, win)
    try {
      const r = p.preset === 'claude' ? await callClaude(row, model, req) : await callOpenAiCompatible(row, model, req)
      track(p.id, true, r.tokens)
      getDb()
        .prepare('INSERT INTO ai_log (provider, model, task, customer_data, chars_sent, at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(p.name, model, req.task, req.customerData ? 1 : 0, req.system.length + req.prompt.length, Date.now())
      return { text: r.text, provider: p.name, model }
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError((e as Error).message, 30_000)
      track(p.id, false)
      if (err.retryAfterMs) cooldown(p.id, err.retryAfterMs)
      errors.push(`${p.name}: ${err.message}`)
      log.warn('Provedor de IA falhou', { provedor: p.name, erro: err.message })
    }
  }
  throw new Error('Todos os provedores falharam: ' + errors.join(' · '))
}

export async function testProvider(id: number): Promise<string> {
  const row = getDb().prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as unknown as Row | undefined
  if (!row) throw new Error('Provedor não encontrado')
  const req: AiRequest = {
    task: 'teste',
    tier: 'fast',
    system: 'Responda em português.',
    prompt: 'Diga "funcionando" e nada mais.',
    customerData: false,
    maxTokens: 50
  }
  const r =
    row.preset === 'claude'
      ? await callClaude(row, row.model_fast ?? '', req)
      : await callOpenAiCompatible(row, row.model_fast ?? '', req)
  track(id, true, r.tokens)
  getDb().prepare('UPDATE ai_providers SET cooldown_until = 0 WHERE id = ?').run(id)
  return r.text
}

export function recentAiLog(
  limit = 50
): Array<{ provider: string; model: string; task: string; customerData: boolean; charsSent: number; at: number }> {
  return (
    getDb().prepare('SELECT * FROM ai_log ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>
  ).map((r) => ({
    provider: r.provider as string,
    model: r.model as string,
    task: r.task as string,
    customerData: !!r.customer_data,
    charsSent: r.chars_sent as number,
    at: r.at as number
  }))
}
