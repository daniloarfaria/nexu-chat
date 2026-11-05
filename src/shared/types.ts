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
