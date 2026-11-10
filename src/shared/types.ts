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
  'funil',
  'ia',
  'status',
  'metaConversoes',
  'leadsPlanilha',
  'perfilIa'
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
  status: {
    label: 'Status do WhatsApp',
    description: 'Postar texto, foto ou vídeo no status, agora ou agendado',
    group: 'Marketing'
  },
  metaConversoes: {
    label: 'Anúncios da Meta',
    description: 'Saber quais conversas vieram de anúncio e avisar a Meta das vendas',
    group: 'Marketing'
  },
  gruposEnvio: { label: 'Envio para grupos', description: 'Campanhas para vários grupos', group: 'Grupos' },
  gruposExtrair: { label: 'Extrair membros', description: 'Exportar participantes para contatos', group: 'Grupos' },
  gruposCriar: { label: 'Criar grupos', description: 'Criar grupos a partir de listas', group: 'Grupos' },
  gruposModeracao: { label: 'Moderação', description: 'Boas-vindas, anti-link e regras', group: 'Grupos' },
  vendas: { label: 'Vendas', description: 'Marcar o que virou venda e ver o retorno', group: 'Vendas' },
  funil: {
    label: 'Funis (Kanban)',
    description: 'Quadros com etapas personalizadas e disparo por coluna',
    group: 'Vendas'
  },
  ia: { label: 'Assistente de IA', description: 'Playbook de vendas e mensagens sugeridas', group: 'Vendas' },
  leadsPlanilha: {
    label: 'Planilha de leads',
    description: 'Traz os leads do site e mostra quais viraram conversa e venda, por origem do anúncio',
    group: 'Marketing'
  },
  perfilIa: {
    label: 'Perfil do cliente pela IA',
    description:
      'A IA lê a conversa e anota preferências nas notas do cliente (sem dado de saúde). Só liga com o Assistente de IA ligado. Ao ligar, você autoriza enviar trechos anonimizados das conversas à IA em segundo plano, sem clique',
    group: 'Vendas'
  }
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
  funil: true,
  ia: false,
  status: false,
  metaConversoes: false,
  leadsPlanilha: false,
  perfilIa: false
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
  /** Conversa que começou num anúncio de clique para o WhatsApp */
  fromAd?: boolean
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
  transcript?: string | null // transcrição do áudio (Whisper)
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
  type: 'tags' | 'all' | 'groups' | 'list' | 'stages'
  tags?: string[]
  /** 'any' = tem pelo menos uma das etiquetas (padrão); 'all' = tem todas */
  tagMode?: 'any' | 'all'
  excludeTags?: string[]
  /** Colunas de funil (type 'stages'); as etiquetas, se houver, filtram junto */
  stageIds?: number[]
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
  sourceType: 'campaign' | 'reminder' | 'group' | 'organic' | 'ad'
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

export type AiPreset = 'groq' | 'gemini' | 'openrouter' | 'mistral' | 'ollama' | 'claude' | 'local' | 'custom'
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

// ---------- Contexto do negócio (IA) ----------

/** O que a IA sabe da loja. Um por número de WhatsApp (settings `ai.context.<accountId>`). */
export interface BusinessContext {
  about: string // o que a loja vende e para quem
  products: string // produtos e serviços, com preço e prazo
  hours: string // horário de funcionamento e endereço
  payment: string // formas de pagamento
  policies: string // troca, garantia e entrega
  faq: string // perguntas frequentes
  tone: string // tom de voz
  forbidden: string // o que a IA não pode falar
  updatedAt: number | null
}
export type BusinessContextField = Exclude<keyof BusinessContext, 'updatedAt'>

// ---------- IA no computador (motor local) ----------

export type LocalModelTier = 'leve' | 'medio'

export interface HardwareInfo {
  platform: string
  arch: string
  totalMemGb: number
  freeMemGb: number
  cpus: number
  cpuModel: string
  freeDiskGb: number | null
}

export interface AiRecommendation {
  /** O sistema tem motor pronto para baixar (Mac Apple Silicon/Intel, Windows 64 bits). */
  localSupported: boolean
  /** Memória e disco dão conta do modelo leve. */
  localRecommended: boolean
  /** Modelo médio aparece como opção (16 GB ou mais). */
  offerMedium: boolean
  /** Sugestão principal: as duas juntas (local principal, nuvem reserva) ou só a nuvem. */
  primary: 'ambas' | 'nuvem'
  reasons: string[]
  slowWarning: boolean
}

export interface LocalModelInfo {
  id: string
  tier: LocalModelTier
  name: string
  sizeMb: number
  installed: boolean
  offered: boolean
}

export interface LocalAiProgress {
  stage: 'motor' | 'modelo' | 'conferindo' | 'preparando'
  label: string
  received: number
  total: number
}

export interface LocalAiStatus {
  hardware: HardwareInfo
  recommendation: AiRecommendation
  engineInstalled: boolean
  engineVersion: string
  models: LocalModelInfo[]
  mediumEnabled: boolean
  running: boolean
  installing: LocalAiProgress | null
  diskUsedMb: number
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

// ---------- Transcrição de áudio ----------

export type TranscribeMode = 'off' | 'manual' | 'auto'
export type TranscribeEngine = 'auto' | 'local' | 'groq'

export interface TranscribeSettings {
  mode: TranscribeMode
  engine: TranscribeEngine
  whisperPath: string | null // whisper-cli (whisper.cpp)
  modelPath: string | null // ggml-*.bin
  ffmpegPath: string | null
}

export interface TranscribeStatus {
  settings: TranscribeSettings
  local: { ready: boolean; whisper: string | null; model: string | null; ffmpeg: string | null }
  groq: boolean
}

// ---------- Licença ----------

export type PlanId = 'basico' | 'marketing' | 'completo'

export const PLANS: Record<PlanId, { nome: string; modulos: ModuleKey[] }> = {
  basico: { nome: 'Básico', modulos: ['conversas'] },
  marketing: {
    nome: 'Marketing',
    modulos: [
      'conversas',
      'campanhas',
      'antiban',
      'lembretes',
      'respostasAuto',
      'gruposEnvio',
      'gruposExtrair',
      'gruposCriar',
      'gruposModeracao',
      'funil',
      'status',
      'metaConversoes',
      'leadsPlanilha'
    ]
  },
  completo: { nome: 'Completo', modulos: [...MODULE_KEYS] }
}

export interface LicensePayload {
  v: 1
  id: string
  cliente: string
  documento?: string
  plano: PlanId
  contas: number
  modulos: ModuleKey[]
  emitida: string // AAAA-MM-DD
  validade: string | null // AAAA-MM-DD (último dia válido); null = sem vencimento
  // Chaves emitidas pelo site (login com e-mail e senha)
  email?: string
  dispositivo?: string // hash do computador para o qual a chave foi emitida
  fim?: string | null // fim real da licença (a validade é uma janela que o app renova)
  teste?: boolean
  online?: boolean
}

export interface LicenseStatus {
  state: 'dev' | 'none' | 'active' | 'grace' | 'expired' | 'invalid'
  payload: LicensePayload | null
  daysLeft: number | null // dias até vencer (ou até acabar a tolerância)
  modules: ModuleKey[] // módulos liberados agora
  maxAccounts: number
  message: string
  /** Conta do site conectada (login com e-mail e senha) */
  online?: { email: string } | null
  /** Aviso da última verificação online (ex.: licença encerrada) */
  notice?: string | null
}

// ---------- Etiquetas ----------

export const TAG_COLORS = [
  'slate',
  'red',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'sky',
  'blue',
  'indigo',
  'violet',
  'pink'
] as const
export type TagColor = (typeof TAG_COLORS)[number]

export interface TagDef {
  name: string
  color: TagColor
  description: string | null
  count: number
}

// ---------- Funis (Kanban) ----------

export type StageKind = 'open' | 'won' | 'lost'

export interface PipelineStage {
  id: number
  name: string
  color: TagColor
  kind: StageKind
  position: number
  /** Etiqueta colocada no contato quando o cartão entra nesta coluna */
  autoTag: string | null
  /** Tira a etiqueta automática quando o cartão sai da coluna */
  removeTagOnLeave: boolean
  /** Avisa quando o cartão fica parado mais que N dias */
  slaDays: number | null
  description: string | null
  count: number
  valueCents: number
}

export interface Pipeline {
  id: number
  name: string
  color: TagColor
  position: number
  createdAt: number
  stages: PipelineStage[]
}

export interface PipelineStageInput {
  id?: number
  name: string
  color: TagColor
  kind: StageKind
  autoTag?: string | null
  removeTagOnLeave?: boolean
  slaDays?: number | null
  description?: string | null
}

export interface PipelineCard {
  id: number
  pipelineId: number
  stageId: number
  personId: number
  name: string | null
  phone: string
  jid: string | null
  tags: string[]
  optOut: boolean
  valueCents: number
  note: string | null
  position: number
  createdAt: number
  movedAt: number
  lastMessageAt: number | null
  lastPreview: string | null
  unread: number
}

export interface PipelineBoard {
  pipeline: Pipeline
  cards: PipelineCard[]
}

/** Em que funis e colunas um contato (ou conversa) está. */
export interface CardPlacement {
  cardId: number
  personId: number
  pipelineId: number
  pipelineName: string
  stageId: number
  stageName: string
  stageColor: TagColor
  stageKind: StageKind
  valueCents: number
}

export interface PipelineTemplate {
  id: string
  name: string
  description: string
  stages: PipelineStageInput[]
}

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: 'vendas',
    name: 'Funil de vendas',
    description: 'Do primeiro contato ao fechamento',
    stages: [
      { name: 'Novo contato', color: 'sky', kind: 'open' },
      { name: 'Em conversa', color: 'blue', kind: 'open', slaDays: 2 },
      { name: 'Orçamento enviado', color: 'amber', kind: 'open', slaDays: 3 },
      { name: 'Negociação', color: 'orange', kind: 'open', slaDays: 5 },
      { name: 'Ganho', color: 'green', kind: 'won' },
      { name: 'Perdido', color: 'slate', kind: 'lost' }
    ]
  },
  {
    id: 'pedidos',
    name: 'Pedidos e entregas',
    description: 'Acompanhar o pedido até a entrega',
    stages: [
      { name: 'Pedido feito', color: 'sky', kind: 'open' },
      { name: 'Em produção', color: 'violet', kind: 'open', slaDays: 7 },
      { name: 'Pronto para retirar', color: 'amber', kind: 'open', slaDays: 3 },
      { name: 'Entregue', color: 'green', kind: 'won' }
    ]
  },
  {
    id: 'posvenda',
    name: 'Pós-venda e recompra',
    description: 'Relacionamento depois da compra',
    stages: [
      { name: 'Comprou', color: 'green', kind: 'open' },
      { name: 'Pesquisa de satisfação', color: 'sky', kind: 'open', slaDays: 7 },
      { name: 'Indicou alguém', color: 'violet', kind: 'open' },
      { name: 'Pronto para recompra', color: 'amber', kind: 'open' },
      { name: 'Recomprou', color: 'green', kind: 'won' }
    ]
  },
  {
    id: 'vazio',
    name: 'Em branco',
    description: 'Três colunas para você renomear',
    stages: [
      { name: 'A fazer', color: 'slate', kind: 'open' },
      { name: 'Em andamento', color: 'blue', kind: 'open' },
      { name: 'Concluído', color: 'green', kind: 'won' }
    ]
  }
]

// ---------- Planilha de leads ----------

export interface LeadsConfig {
  url: string
  hasSecret: boolean
  createContacts: boolean
  pipelineId: number | null
  lastSyncAt: number | null
  lastError: string | null
  lastAdded: number
}

export interface LeadsConfigInput {
  url: string
  /** Vazio mantém a senha já guardada */
  secret?: string
  createContacts?: boolean
  pipelineId?: number | null
}

export interface LeadsSyncResult {
  ok: boolean
  added: number
  contacts: number
  error?: string
}

export interface LeadItem {
  id: number
  createdAt: number
  tab: string
  name: string | null
  email: string | null
  phone: string | null
  interest: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  utmTerm: string | null
  page: string | null
  /** virou conversa no WhatsApp */
  chat: boolean
  personId: number | null
  pipeline: string | null
  stage: string | null
  won: boolean
  valueCents: number
}

export type LeadsDimension = 'source' | 'campaign' | 'content'

export interface LeadsReportRow {
  key: string
  leads: number
  talked: number
  bought: number
  revenueCents: number
  /** compraram / leads (0 a 1) */
  rate: number
}

export interface LeadsReport {
  total: LeadsReportRow
  bySource: LeadsReportRow[]
  byCampaign: LeadsReportRow[]
  byContent: LeadsReportRow[]
}

// ---------- Status do WhatsApp ----------

export type StatusKind = 'texto' | 'imagem' | 'video'
export type StatusPostState = 'agendado' | 'enviando' | 'enviado' | 'falhou' | 'cancelado'

/** Quem vê o status: todos os contatos com WhatsApp, só quem tem a etiqueta, ou todos menos quem tem a etiqueta. */
export interface StatusAudience {
  modo: 'todos' | 'etiqueta' | 'todos_menos'
  tags: string[]
}

export interface StatusMedia {
  name: string
  mime: string
  file: string
  size: number
}

export interface StatusPost {
  id: number
  accountId: string
  kind: StatusKind
  text: string | null
  media: StatusMedia | null
  background: string | null
  font: number | null
  audience: StatusAudience
  scheduledAt: number
  status: StatusPostState
  error: string | null
  sentAt: number | null
  recipientsCount: number | null
  createdAt: number
}

export interface StatusSettings {
  dailyLimit: number
}

// ---------- Notas do cliente e datas ----------

export const NOTE_KINDS = ['geral', 'perfil', 'preferencia', 'objecao', 'familia'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  geral: 'Geral',
  perfil: 'Perfil',
  preferencia: 'Preferência',
  objecao: 'Objeção',
  familia: 'Família'
}

export interface ContactNote {
  id: number
  accountId: string
  personId: number
  kind: NoteKind
  title: string
  body: string
  author: 'atendente' | 'ia'
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface NoteInput {
  id?: number
  kind: NoteKind
  title: string
  body: string
  pinned?: boolean
}

/** Alvo das notas: o contato, ou a conversa (o contato é achado ou criado pelo número). */
export type NoteTarget = { personId: number } | { chatJid: string }

export interface ProfileMapResult {
  added: ContactNote[]
  /** Aniversário que a IA achou na conversa (só sugestão, nada é salvo). */
  birthday: string | null
}

export interface DateHistoryItem {
  kind: ReminderKind
  label: string
  at: number
}

export interface BirthdaySuggestion {
  /** MM-DD ou AAAA-MM-DD, no formato interno */
  date: string
  /** Trecho da conversa que gerou a sugestão (sem dados de outros clientes) */
  quote: string
}
