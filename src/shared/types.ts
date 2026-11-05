// Tipos compartilhados entre o processo principal, o preload e a interface.

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export const MODULE_KEYS = [
  'conversas',
  'campanhas',
  'antiban',
  'gruposEnvio',
  'gruposExtrair',
  'gruposCriar',
  'gruposModeracao',
  'respostasAuto',
  'lembretes',
  'vendas',
  'ia'
] as const

export type ModuleKey = (typeof MODULE_KEYS)[number]
export type Modules = Record<ModuleKey, boolean>

export const MODULE_INFO: Record<ModuleKey, { label: string; description: string; group: string }> = {
  conversas: { label: 'Conversas', description: 'Receber e enviar mensagens pelo app', group: 'Atendimento' },
  respostasAuto: {
    label: 'Respostas automáticas',
    description: 'Por palavra-chave e fora do horário',
    group: 'Atendimento'
  },
  campanhas: { label: 'Campanhas', description: 'Disparos para listas de contatos', group: 'Marketing' },
  antiban: { label: 'Proteção anti-bloqueio', description: 'Limites, pausas e monitor de saúde', group: 'Marketing' },
  lembretes: {
    label: 'Lembretes recorrentes',
    description: 'Aniversário, pós-venda, revisão anual',
    group: 'Marketing'
  },
  gruposEnvio: { label: 'Envio para grupos', description: 'Campanhas para vários grupos', group: 'Grupos' },
  gruposExtrair: { label: 'Extrair membros', description: 'Exportar participantes para contatos', group: 'Grupos' },
  gruposCriar: { label: 'Criar grupos', description: 'Criar grupos a partir de listas', group: 'Grupos' },
  gruposModeracao: { label: 'Moderação', description: 'Boas-vindas, anti-link e regras', group: 'Grupos' },
  vendas: { label: 'Vendas', description: 'Marcar o que virou venda e ver o retorno', group: 'Vendas' },
  ia: { label: 'Assistente de IA', description: 'Playbook de vendas e mensagens sugeridas', group: 'Vendas' }
}

export const DEFAULT_MODULES: Modules = {
  conversas: true,
  campanhas: true,
  antiban: true,
  gruposEnvio: false,
  gruposExtrair: false,
  gruposCriar: false,
  gruposModeracao: false,
  respostasAuto: false,
  lembretes: false,
  vendas: true,
  ia: false
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out'

export interface Account {
  id: string
  name: string
  color: string
  phone: string | null
  modules: Modules
  autoConnect: boolean
  createdAt: number
}

export interface AccountState {
  accountId: string
  status: ConnectionStatus
  qr?: string // data URL do QR Code
  pairingCode?: string
  phone?: string | null
  error?: string
}

export interface WaVersionInfo {
  version: [number, number, number]
  source: 'wppconnect' | 'whatsapp-web' | 'cache' | 'padrao'
  checkedAt: number
}

export type BackupFrequency = 'off' | 'daily' | 'weekly' | 'on_close'

export interface BackupSettings {
  folder: string | null
  frequency: BackupFrequency
  keep: number
  passwordSet: boolean
  lastBackupAt: number | null
  lastError: string | null
}

export interface BackupFile {
  name: string
  size: number
  createdAt: number
}

export interface AppInfo {
  version: string
  platform: string
  dataPath: string
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  currentVersion: string
  version?: string
  releaseDate?: string
  notes?: string
  percent?: number
  checkedAt?: number
  error?: string
}

// ---------- Conversas ----------

export interface ChatItem {
  jid: string
  name: string
  phone: string | null
  isGroup: boolean
  unread: number
  lastTs: number
  lastPreview: string | null
  lastFromMe: boolean
  archived: boolean
  pinned: boolean
  muted: boolean
  readOnly: boolean
}

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'gif'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'poll'
  | 'event'
  | 'call'
  | 'system'
  | 'unsupported'

export interface MediaInfo {
  mimetype?: string
  fileName?: string
  size?: number
  seconds?: number
  width?: number
  height?: number
  thumb?: string // data URL pequeno (miniatura que vem na mensagem)
  url?: string // dspmedia://… quando já baixado
  viewOnce?: boolean
  animated?: boolean
}

export interface MessageExtra {
  location?: { lat: number; lng: number; name?: string; address?: string; live?: boolean }
  contacts?: Array<{ name: string; vcard: string; phones: string[] }>
  poll?: { name: string; options: string[]; selectable: number; votes?: Record<string, number> }
  quoted?: { id: string; text: string; type: MessageType; senderName?: string; fromMe: boolean }
  forwarded?: boolean
  label?: string // tipos não suportados ou mensagens de sistema
}

export interface MessageItem {
  id: string
  rid?: number // posição no banco (cursor da paginação)
  chatJid: string
  fromMe: boolean
  sender: string | null
  senderName: string | null
  ts: number
  type: MessageType
  text: string | null
  media: MediaInfo | null
  extra: MessageExtra | null
  quotedId: string | null
  status: number // 0 erro, 1 pendente, 2 enviada, 3 entregue, 4 lida, 5 ouvida
  reactions: Record<string, string> | null // remetente → emoji
  edited: boolean
  deleted: boolean
}

export interface SyncState {
  accountId: string
  progress: number | null
  messages: number
  chats: number
  running: boolean
  finishedAt: number | null
}

export type ChatFilter = 'all' | 'unread' | 'groups' | 'archived'

export interface OutgoingFile {
  name: string
  mime: string
  data: Uint8Array
}

// ---------- Contatos (base de clientes) ----------

export interface Person {
  id: number
  phone: string
  jid: string | null
  name: string | null
  birthday: string | null // AAAA-MM-DD ou MM-DD
  fields: Record<string, string>
  tags: string[]
  optOut: boolean
  hasWa: boolean | null
  createdAt: number
}

export interface PersonQuery {
  accountId: string
  search?: string
  tag?: string | null
  optOut?: 'all' | 'only' | 'exclude'
  limit: number
  offset: number
}

export interface ImportPreview {
  token: string
  sheets: string[]
  sheet: string
  headers: string[]
  rows: string[][]
  total: number
  suggested: ImportMapping
}

export interface ImportMapping {
  name: number | null
  phone: number | null
  birthday: number | null
  extra: Array<{ column: number; field: string }>
}

export interface ImportResult {
  imported: number
  updated: number
  invalid: number
  duplicates: number
  invalidSamples: string[]
}

// ---------- Proteção anti-bloqueio ----------

export interface AntiBanSettings {
  minDelay: number // segundos entre mensagens
  maxDelay: number
  pauseEvery: number // pausa longa a cada N envios
  pauseMin: number // minutos
  pauseMax: number
  dailyLimit: number
  hourStart: number // 0-23
  hourEnd: number
  days: number[] // 0=domingo … 6=sábado
  typing: boolean
  warmup: boolean
  warmupStartedAt: number | null
  minReplyRate: number // % abaixo do qual pausa (após 30 envios)
  maxFailStreak: number
}

export const ANTIBAN_PRESETS: Record<'seguro' | 'equilibrado' | 'rapido', Partial<AntiBanSettings>> = {
  seguro: { minDelay: 90, maxDelay: 240, pauseEvery: 12, pauseMin: 15, pauseMax: 30, dailyLimit: 120 },
  equilibrado: { minDelay: 60, maxDelay: 180, pauseEvery: 18, pauseMin: 10, pauseMax: 20, dailyLimit: 200 },
  rapido: { minDelay: 30, maxDelay: 90, pauseEvery: 25, pauseMin: 5, pauseMax: 10, dailyLimit: 350 }
}

// ---------- Campanhas ----------

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'done' | 'canceled'
export type TargetStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'no_wa' | 'opted_out'

export interface CampaignAudience {
  type: 'tags' | 'all' | 'groups' | 'list'
  tags?: string[]
  excludeTags?: string[]
  groups?: string[]
  personIds?: number[]
}

export interface CampaignMedia {
  name: string
  mime: string
  file: string // nome do arquivo guardado na pasta do app
  size: number
}

export interface CampaignInput {
  id?: number
  accountId: string
  name: string
  templates: string[]
  audience: CampaignAudience
  optOutFooter: boolean
  scheduledAt: number | null
}

export interface CampaignStats {
  total: number
  pending: number
  sent: number
  failed: number
  skipped: number
  noWa: number
  optedOut: number
  delivered: number
  read: number
  replied: number
}

export interface Campaign {
  id: number
  accountId: string
  name: string
  kind: 'people' | 'groups' | 'reminder'
  status: CampaignStatus
  templates: string[]
  media: CampaignMedia | null
  audience: CampaignAudience
  optOutFooter: boolean
  scheduledAt: number | null
  startedAt: number | null
  finishedAt: number | null
  pausedReason: string | null
  createdAt: number
  stats: CampaignStats
  nextSendAt?: number | null
}

export interface CampaignTarget {
  seq: number
  name: string | null
  phone: string | null
  status: TargetStatus
  error: string | null
  sentAt: number | null
  deliveredAt: number | null
  readAt: number | null
  repliedAt: number | null
}

export interface EngineState {
  accountId: string
  campaignId: number | null
  phase: 'idle' | 'sending' | 'waiting' | 'paused_long' | 'outside_hours' | 'daily_limit' | 'disconnected'
  nextAt: number | null
  sentToday: number
  limitToday: number
  message?: string
}

// ---------- Respostas automáticas ----------

export type AutoRuleKind = 'keyword' | 'away' | 'welcome'

export interface AutoRule {
  id: number
  name: string
  kind: AutoRuleKind
  enabled: boolean
  keywords: string[]
  matchMode: 'contains' | 'exact' | 'starts'
  reply: string
  cooldownMin: number
  schedule?: { hourStart: number; hourEnd: number; days: number[] }
}

// ---------- Lembretes ----------

export type ReminderKind = 'birthday' | 'days_after' | 'yearly'

export interface Reminder {
  id: number
  name: string
  kind: ReminderKind
  field: string | null // campo de data do contato (dias depois / anual)
  offsetDays: number
  sendHour: number
  template: string
  tags: string[]
  enabled: boolean
  lastRunDay: string | null
}

// ---------- Vendas ----------

export interface Deal {
  id: number
  chatJid: string
  chatName: string
  status: 'won' | 'lost'
  amountCents: number
  product: string | null
  payment: string | null
  reason: string | null
  note: string | null
  sourceType: 'campaign' | 'reminder' | 'group' | 'organic'
  sourceName: string | null
  createdAt: number
}

export interface SalesSummary {
  revenueCents: number
  won: number
  lost: number
  avgTicketCents: number
  bySource: Array<{
    sourceType: Deal['sourceType']
    sourceId: number | null
    name: string
    won: number
    revenueCents: number
    sent: number
  }>
  lostReasons: Array<{ reason: string; count: number }>
  byDay: Array<{ day: string; revenueCents: number; won: number }>
}

export const LOST_REASONS = [
  'Preço',
  'Sem estoque',
  'Só pesquisando',
  'Comprou em outro lugar',
  'Não respondeu',
  'Outro'
] as const
export const PAYMENT_METHODS = [
  'Pix',
  'Cartão de crédito',
  'Cartão de débito',
  'Dinheiro',
  'Boleto',
  'Crediário'
] as const

// ---------- Assistente de IA ----------

export type AiPreset = 'groq' | 'gemini' | 'openrouter' | 'mistral' | 'ollama' | 'claude' | 'custom'
export type AiPrivacy = 'estrita' | 'anonimizar' | 'livre'

export interface AiProvider {
  id: number
  preset: AiPreset
  name: string
  baseUrl: string
  hasKey: boolean
  modelFast: string
  modelSmart: string
  trainsOnData: boolean
  rpm: number | null
  rpd: number | null
  paid: boolean
  enabled: boolean
  priority: number
  usedToday: number
  errorsToday: number
  cooldownUntil: number
}

export interface AiSettings {
  privacy: AiPrivacy
  paidMonthlyLimit: number // máximo de chamadas pagas por mês
}

export interface AiUsageEntry {
  provider: string
  model: string
  task: string
  customerData: boolean
  charsSent: number
  at: number
}

// ---------- Grupos ----------

export interface GroupInfo {
  jid: string
  subject: string
  description: string | null
  size: number
  isAdmin: boolean
  announce: boolean
  updatedAt: number
}

export interface GroupRule {
  welcome: string | null
  antiLink: boolean
  bannedWords: string[]
  maxWarnings: number
}
