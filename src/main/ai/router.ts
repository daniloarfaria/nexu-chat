import Anthropic from '@anthropic-ai/sdk'
import type { AiPreset, AiProvider, AiSettings } from '@shared/types'
import { getDb, getSetting, setSetting } from '../db'
import { sealString, unsealString } from '../secure'
import { dayKey, isLoopbackUrl } from '@shared/rules'
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
  // A chave é sempre a do próprio usuário; o app não embute nenhuma.
  nvidia: {
    name: 'NVIDIA',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    fast: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    smart: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    trains: true, // não há garantia pública de que não usa os textos: tratado como "pode treinar"
    rpm: 40,
    rpd: null,
    paid: false,
    keyUrl: 'https://build.nvidia.com/settings/api-keys'
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    fast: 'deepseek-flash',
    smart: 'deepseek-v4-pro',
    trains: true, // servidores fora do Brasil: tratado como "pode treinar"
    rpm: null,
    rpd: null,
    paid: true,
    keyUrl: 'https://platform.deepseek.com/api_keys'
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
  // Motor local (llama.cpp) instalado pelo próprio app. O endereço muda a cada vez que o motor sobe.
  local: {
    name: 'IA no computador',
    baseUrl: 'http://127.0.0.1',
    fast: 'gemma3-1b',
    smart: 'gemma3-1b',
    trains: false,
    rpm: null,
    rpd: null,
    paid: false,
    keyUrl: ''
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

/** Entram com "usar em conversas de clientes" desligado: o dono liga de propósito, depois de ler o aviso. */
const ASK_BEFORE_CUSTOMERS: ReadonlySet<AiPreset> = new Set(['nvidia', 'deepseek'])
/** Sem garantia pública sobre o uso dos textos: ficam sempre como "pode treinar". */
const ALWAYS_TRAINS: ReadonlySet<AiPreset> = new Set(['nvidia', 'deepseek'])
/** Só valem apontando para este computador. */
const LOOPBACK_ONLY: ReadonlySet<AiPreset> = new Set(['ollama', 'local'])

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
  no_customer_data: number
  rpm: number | null
  rpd: number | null
  monthly_limit: number | null
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

/** Pedidos de cada provedor no mês corrente. */
function usageThisMonth(): Map<number, number> {
  const rows = getDb()
    .prepare(
      'SELECT provider_id AS id, COALESCE(SUM(requests), 0) AS n FROM ai_usage WHERE day LIKE ? GROUP BY provider_id'
    )
    .all(`${dayKey().slice(0, 7)}-%`) as Array<{ id: number; n: number }>
  return new Map(rows.map((r) => [r.id, r.n]))
}

export function listProviders(): AiProvider[] {
  const month = usageThisMonth()
  const defaultLimit = getAiSettings().paidMonthlyLimit
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
        noCustomerData: !!r.no_customer_data,
        rpm: r.rpm,
        rpd: r.rpd,
        paid: !!r.paid,
        enabled: !!r.enabled,
        priority: r.priority,
        usedToday: u.requests,
        errorsToday: u.errors,
        cooldownUntil: r.cooldown_until,
        usedMonth: month.get(r.id) ?? 0,
        monthlyLimit: r.paid ? (r.monthly_limit ?? defaultLimit) : null
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
  noCustomerData?: boolean
  rpm?: number | null
  monthlyLimit?: number | null
  enabled?: boolean
  priority?: number
}): AiProvider {
  const db = getDb()
  const cur = p.id
    ? (db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(p.id) as unknown as Row | undefined)
    : undefined
  if (p.id && !cur) throw new Error('Provedor não encontrado')
  // A IA no computador só é criada pelo assistente "Configurar IA" (que baixa e confere o motor)
  if ((p.preset === 'local' || cur?.preset === 'local') && (!cur || cur.preset !== p.preset))
    throw new Error('Use o botão Configurar IA para instalar a IA no computador')
  // O preset gravado é o que vale: o pedido não troca o tipo de um provedor que já existe
  const kind: AiPreset = cur?.preset ?? p.preset
  const preset = kind !== 'custom' ? PRESETS[kind] : null
  const baseUrl = validateBaseUrl(p.baseUrl ?? cur?.base_url ?? preset?.baseUrl ?? '')
  if (LOOPBACK_ONLY.has(kind) && !isLoopbackUrl(baseUrl))
    throw new Error(
      'Este provedor roda no próprio computador: o endereço precisa ser localhost ou 127.0.0.1. Para um servidor de fora, cadastre um provedor personalizado.'
    )
  let key = p.apiKey === undefined ? undefined : p.apiKey ? sealString(p.apiKey.trim()) : null
  // Endereço mudou de servidor: a chave antiga não vai junto (precisa ser informada de novo)
  if (cur && key === undefined && new URL(baseUrl).origin !== new URL(cur.base_url).origin) key = null
  const trains = (v: boolean): number => (ALWAYS_TRAINS.has(kind) || v ? 1 : 0)
  if (p.id && cur) {
    db.prepare(
      `UPDATE ai_providers SET name = ?, base_url = ?, api_key = ?, model_fast = ?, model_smart = ?, trains_on_data = ?, no_customer_data = ?, rpm = ?, monthly_limit = ?, enabled = ?, priority = ?, cooldown_until = 0 WHERE id = ?`
    ).run(
      p.name ?? cur.name,
      baseUrl,
      key === undefined ? cur.api_key : key,
      p.modelFast ?? cur.model_fast,
      p.modelSmart ?? cur.model_smart,
      trains(p.trainsOnData ?? !!cur.trains_on_data),
      p.noCustomerData === undefined ? cur.no_customer_data : p.noCustomerData ? 1 : 0,
      p.rpm === undefined ? cur.rpm : p.rpm,
      p.monthlyLimit === undefined ? cur.monthly_limit : p.monthlyLimit,
      p.enabled === undefined ? cur.enabled : p.enabled ? 1 : 0,
      p.priority ?? cur.priority,
      p.id
    )
    return listProviders().find((x) => x.id === p.id)!
  }
  const id = db
    .prepare(
      `INSERT INTO ai_providers (preset, name, base_url, api_key, model_fast, model_smart, trains_on_data, no_customer_data, rpm, rpd, monthly_limit, paid, enabled, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      kind,
      p.name ?? preset?.name ?? 'Provedor',
      baseUrl,
      key ?? null,
      p.modelFast ?? preset?.fast ?? '',
      p.modelSmart ?? preset?.smart ?? p.modelFast ?? '',
      trains(p.trainsOnData ?? preset?.trains ?? true),
      (p.noCustomerData ?? ASK_BEFORE_CUSTOMERS.has(kind)) ? 1 : 0,
      p.rpm === undefined ? (preset?.rpm ?? null) : p.rpm,
      preset?.rpd ?? null,
      p.monthlyLimit ?? null,
      preset?.paid ? 1 : 0,
      p.priority ?? 100,
      Date.now()
    ).lastInsertRowid
  return listProviders().find((x) => x.id === Number(id))!
}

/** Só https; http apenas para modelos no próprio computador. Sem usuário/senha na URL. */
export function validateBaseUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error('Endereço da API inválido')
  }
  if (u.username || u.password) throw new Error('O endereço não pode conter usuário ou senha')
  if (u.protocol === 'http:') {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
      throw new Error('Use https (http só é aceito para modelos no próprio computador)')
  } else if (u.protocol !== 'https:') throw new Error('Endereço da API inválido')
  u.hash = ''
  u.search = ''
  return u.toString().replace(/\/+$/, '')
}

/** Cadastra (ou atualiza) a IA no computador como provedor. Só o assistente "Configurar IA" chama. */
export function upsertLocalProvider(modelFast: string, modelSmart: string): void {
  const db = getDb()
  const cur = db.prepare("SELECT id FROM ai_providers WHERE preset = 'local'").get() as { id: number } | undefined
  if (cur) {
    db.prepare(
      'UPDATE ai_providers SET model_fast = ?, model_smart = ?, enabled = 1, cooldown_until = 0 WHERE id = ?'
    ).run(modelFast, modelSmart, cur.id)
    return
  }
  db.prepare(
    `INSERT INTO ai_providers (preset, name, base_url, api_key, model_fast, model_smart, trains_on_data, rpm, rpd, paid, enabled, priority, created_at)
     VALUES ('local', ?, ?, NULL, ?, ?, 0, NULL, NULL, 0, 1, 50, ?)`
  ).run(PRESETS.local.name, PRESETS.local.baseUrl, modelFast, modelSmart, Date.now())
}

export function removeLocalProvider(): void {
  getDb().prepare("DELETE FROM ai_providers WHERE preset = 'local'").run()
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

// ---------- IA no computador ----------

/**
 * Quem executa os pedidos da IA local: sobe o motor se precisar, roda um pedido por vez
 * e devolve o endereço e a chave da vez. Registrado por `ai/local/service.ts` (evita import circular).
 */
export type LocalRunner = <T>(modelId: string, fn: (baseUrl: string, apiKey: string) => Promise<T>) => Promise<T>
let localRunner: LocalRunner | null = null
/** Tamanho do contexto (tokens) de cada modelo local. */
let localCtx: (modelId: string) => number = () => 4096
export function setLocalRunner(r: LocalRunner | null, ctxOf?: (modelId: string) => number): void {
  localRunner = r
  if (ctxOf) localCtx = ctxOf
}

/** Estimativa conservadora de tokens em português (cerca de 3 caracteres por token). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3) + 64 // + modelo de conversa (system/user)
}

/** O pedido cabe no contexto do modelo local, contando a resposta? (função pura para teste) */
export function localFits(req: Pick<AiRequest, 'system' | 'prompt' | 'maxTokens'>, ctx: number): boolean {
  return estimateTokens(req.system.length + req.prompt.length) + (req.maxTokens ?? 2000) <= ctx
}

async function callLocal(p: Row, model: string, req: AiRequest): Promise<{ text: string; tokens: number }> {
  if (!localRunner) throw new ProviderError('IA no computador não instalada', 10 * 60_000)
  try {
    return await localRunner(model, (baseUrl, apiKey) =>
      // computador fraco: dá mais tempo para responder
      callOpenAiCompatible({ ...p, base_url: baseUrl }, model, req, { key: apiKey, timeoutMs: 180_000, local: true })
    )
  } catch (e) {
    if (e instanceof ProviderError) throw e
    // motor não subiu (arquivo apagado, antivírus, falta de memória): espera antes de tentar de novo
    throw new ProviderError((e as Error).message, 5 * 60_000)
  }
}

async function callOpenAiCompatible(
  p: Row,
  model: string,
  req: AiRequest,
  opts: { key?: string; timeoutMs?: number; local?: boolean } = {}
): Promise<{ text: string; tokens: number }> {
  const key = opts.key ?? (p.api_key ? unsealString(p.api_key) : '')
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
    // nunca segue redirecionamento: a chave e o texto só vão para o endereço cadastrado
    redirect: 'error',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000)
  })
  if (!res.ok) {
    if (opts.local && res.status === 400) {
      // llama-server: pedido maior que o contexto. Não é defeito do motor: só este pedido vai para outro provedor
      const body = await res.text().catch(() => '')
      if (/exceed|context/i.test(body)) throw new ProviderError('pedido grande demais para a IA no computador', 0)
      throw new ProviderError('erro 400', 60_000)
    }
    await res.body?.cancel().catch(() => undefined) // corpo do erro pode repetir o pedido: não é guardado
    const ra = Number(res.headers.get('retry-after'))
    if (res.status === 429)
      throw new ProviderError('limite atingido', Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000)
    if (res.status === 401 || res.status === 403)
      throw new ProviderError('chave inválida ou sem permissão', 6 * 3600_000, true)
    if (res.status >= 500) throw new ProviderError(`erro do servidor ${res.status}`, 30_000)
    if (res.status === 404) throw new ProviderError('modelo ou endereço não encontrado (erro 404)', 5 * 60_000)
    throw new ProviderError(`erro ${res.status}`, 5 * 60_000)
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
    if (e instanceof Anthropic.BadRequestError) throw new ProviderError('pedido recusado (400)', 5 * 60_000)
    if (e instanceof Anthropic.APIError) throw new ProviderError(`erro ${e.status ?? ''}`, 30_000)
    throw new ProviderError((e as Error).name === 'TimeoutError' ? 'tempo esgotado' : 'falha de conexão', 30_000)
  }
}

/** Ordem de tentativa para um pedido (função pura para teste).
 * - `fast` (classificar, etiquetar, extrair): a IA no computador primeiro, a nuvem de reserva.
 * - `smart` (sugerir resposta, campanhas, playbook): a nuvem gratuita primeiro, a local de reserva.
 *   Exceção: com o modelo médio local ligado (opcional, 16 GB+), a local vem primeiro também no `smart`.
 *   O modelo médio está ligado quando o provedor local tem modelo caprichado diferente do rápido. */
export function candidates(
  providers: AiProvider[],
  req: Pick<AiRequest, 'customerData' | 'premium'> & { tier?: Tier },
  s: AiSettings,
  now = Date.now()
): AiProvider[] {
  const usable = providers.filter(
    (p) =>
      p.enabled &&
      (p.hasKey || LOOPBACK_ONLY.has(p.preset)) &&
      // Ollama só vale se o endereço for mesmo deste computador (cadastro antigo pode apontar para fora).
      // A IA instalada pelo app ('local') não entra aqui: o endereço dela é dado pelo motor a cada pedido.
      !(p.preset === 'ollama' && !isLoopbackUrl(p.baseUrl)) &&
      p.cooldownUntil <= now &&
      (!p.rpd || p.usedToday < p.rpd) &&
      // dados de clientes: no modo estrito, só provedores que não treinam com os dados
      !(req.customerData && p.noCustomerData) &&
      !(req.customerData && s.privacy === 'estrita' && p.trainsOnData) &&
      // cada provedor pago tem o seu contador e o seu limite do mês: esgotar um não tira o outro
      !(p.paid && (p.usedMonth ?? 0) >= (p.monthlyLimit ?? s.paidMonthlyLimit))
  )
  const free = usable
    .filter((p) => !p.paid && p.preset !== 'local')
    .sort((a, b) => a.priority - b.priority || Number(a.trainsOnData) - Number(b.trainsOnData))
  const local = usable.filter((p) => p.preset === 'local')
  const paid = usable.filter((p) => p.paid)
  const localFirst = req.tier === 'fast' || local.some((p) => p.modelSmart && p.modelSmart !== p.modelFast)
  const gratis = localFirst ? [...local, ...free] : [...free, ...local]
  return req.premium ? [...paid, ...gratis] : [...gratis, ...paid]
}

export async function complete(req: AiRequest): Promise<{ text: string; provider: string; model: string }> {
  const settings = getAiSettings()
  const list = candidates(listProviders(), req, settings)
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
    if (p.preset === 'local' && !localFits(req, localCtx(model))) {
      // não cabe no contexto do modelo local: pula sem pausar o provedor
      errors.push(`${p.name}: pedido grande demais para a IA no computador`)
      continue
    }
    const win = minuteWindow.get(p.id) ?? []
    win.push(Date.now())
    minuteWindow.set(p.id, win)
    try {
      const r =
        p.preset === 'claude'
          ? await callClaude(row, model, req)
          : p.preset === 'local'
            ? await callLocal(row, model, req)
            : await callOpenAiCompatible(row, model, req)
      track(p.id, true, r.tokens)
      getDb()
        .prepare('INSERT INTO ai_log (provider, model, task, customer_data, chars_sent, at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(p.name, model, req.task, req.customerData ? 1 : 0, req.system.length + req.prompt.length, Date.now())
      return { text: r.text, provider: p.name, model }
    } catch (e) {
      // erro inesperado (rede, redirecionamento, tempo): mensagem genérica, sem o texto cru do erro
      const err =
        e instanceof ProviderError
          ? e
          : new ProviderError((e as Error)?.name === 'TimeoutError' ? 'tempo esgotado' : 'falha de conexão', 30_000)
      track(p.id, false)
      if (err.retryAfterMs) cooldown(p.id, err.retryAfterMs)
      errors.push(`${p.name}: ${err.message}`)
      log.warn('Provedor de IA falhou', { provedor: p.name, erro: err.message })
    }
  }
  throw new Error('Todos os provedores falharam: ' + errors.join(' · '))
}

/** Mensagem clara, em português, para falha no teste de conexão. */
function explainTestError(e: unknown): string {
  const msg = (e as Error).message ?? ''
  const name = (e as Error).name
  if (name === 'TimeoutError' || name === 'AbortError' || /tempo esgotado/.test(msg))
    return 'O provedor demorou demais para responder. Tente de novo em instantes.'
  if (e instanceof ProviderError) {
    if (e.fatal)
      return 'A chave foi recusada. Confira se copiou a chave inteira, sem espaços, e se ela está ativa no site do provedor.'
    if (/limite/.test(msg))
      return 'Você atingiu o limite de uso do provedor. Espere um pouco ou confira o seu plano no site dele.'
    if (/servidor/.test(msg)) return `O provedor está com problema agora (${msg}). Tente mais tarde.`
    if (/404/.test(msg))
      return 'O provedor não encontrou o modelo ou o endereço (erro 404). O nome do modelo pode ter mudado; edite o modelo em Provedores, conferindo o nome no site do provedor.'
    if (/400|422/.test(msg))
      return `O provedor recusou o pedido (${msg}). O nome do modelo pode ter mudado; edite o modelo em Provedores, conferindo o nome no site do provedor.`
    return `O provedor recusou o pedido (${msg}). Confira o nome do modelo e o endereço.`
  }
  return 'Não consegui conectar ao provedor. Confira a sua internet e o endereço da API.'
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
  let r: { text: string; tokens: number }
  try {
    r =
      row.preset === 'claude'
        ? await callClaude(row, row.model_fast ?? '', req)
        : row.preset === 'local'
          ? await callLocal(row, row.model_fast ?? '', req)
          : await callOpenAiCompatible(row, row.model_fast ?? '', req, { timeoutMs: 25_000 })
  } catch (e) {
    throw new Error(explainTestError(e), { cause: e })
  }
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
