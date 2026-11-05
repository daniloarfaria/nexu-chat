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
