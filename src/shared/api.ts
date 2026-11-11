import type {
  Account,
  AccountState,
  AppInfo,
  BackupFile,
  BackupSettings,
  Modules,
  ChatAiState,
  ChatFilter,
  RobotSettings,
  RecoverySettings,
  RecoveryQueueItem,
  RecoveryFollowupItem,
  RecoveryStats,
  ChatItem,
  MediaInfo,
  MessageItem,
  OutgoingFile,
  SyncState,
  UpdateStatus,
  AntiBanSettings,
  AiProvider,
  AiPreset,
  AiSettings,
  AiUsageEntry,
  AutoRule,
  BusinessContext,
  BirthdaySuggestion,
  ContactNote,
  DateHistoryItem,
  NoteInput,
  ProfileMapResult,
  LocalAiProgress,
  LocalAiStatus,
  Campaign,
  CampaignAudience,
  CampaignTarget,
  Deal,
  EngineState,
  GroupInfo,
  GroupRule,
  LicenseStatus,
  LeadItem,
  LeadsConfig,
  LeadsConfigInput,
  LeadsDimension,
  LeadsReport,
  LeadsSyncResult,
  TranscribeEngine,
  TranscribeMode,
  TranscribeStatus,
  ImportMapping,
  ImportPreview,
  ImportResult,
  Person,
  CardPlacement,
  Pipeline,
  PipelineBoard,
  PipelineStageInput,
  TagColor,
  TagDef,
  Reminder,
  SalesSummary,
  PanelData,
  PanelQuery,
  StatusAudience,
  StatusKind,
  StatusPost,
  StatusSettings,
  TargetStatus,
  WaVersionInfo
} from './types'
import type { SitePage } from './site'

// Mapa tipado de todos os canais IPC (interface → processo principal).
export interface ApiMap {
  'app:info': { args: []; ret: AppInfo }
  'app:open-data-folder': { args: []; ret: void }
  'license:status': { args: []; ret: LicenseStatus }
  'license:activate': { args: [{ key: string }]; ret: LicenseStatus }
  'license:remove': { args: []; ret: LicenseStatus }
  'license:login': { args: [{ email: string; password: string }]; ret: LicenseStatus }
  'license:logout': { args: []; ret: LicenseStatus }
  'license:refresh': { args: []; ret: LicenseStatus }
  'app:open-site': { args: [{ page: SitePage }]; ret: void }
  'novidades:pendentes': {
    args: []
    ret: Array<{ versao: string; data: string; titulo: string; resumo: string; destaques: string[]; url: string }>
  }
  'novidades:vistas': { args: []; ret: void }
  'update:status': { args: []; ret: UpdateStatus }
  'update:check': { args: []; ret: UpdateStatus }
  'update:download': { args: []; ret: void }
  'update:install': { args: []; ret: void }

  'wa:version': { args: []; ret: WaVersionInfo | null }
  'wa:refresh-version': { args: []; ret: WaVersionInfo }

  'accounts:list': { args: []; ret: Account[] }
  'accounts:states': { args: []; ret: AccountState[] }
  'accounts:create': { args: [{ name: string; color: string }]; ret: Account }
  'accounts:update': {
    args: [{ id: string; name?: string; color?: string; modules?: Partial<Modules>; autoConnect?: boolean }]
    ret: Account
  }
  'accounts:delete': { args: [{ id: string }]; ret: void }
  'accounts:connect': { args: [{ id: string; pairingPhone?: string }]; ret: void }
  'accounts:disconnect': { args: [{ id: string }]; ret: void }
  'accounts:logout': { args: [{ id: string }]; ret: void }

  'chats:list': {
    args: [{ accountId: string; filter: ChatFilter; search?: string; limit: number; offset: number }]
    ret: ChatItem[]
  }
  'chats:get': { args: [{ accountId: string; jids: string[] }]; ret: ChatItem[] }
  'chats:read': { args: [{ accountId: string; jid: string }]; ret: void }
  'chats:unread-total': { args: [{ accountId: string }]; ret: number }
  'messages:list': {
    args: [{ accountId: string; jid: string; before: number | null; beforeRid?: number | null; limit: number }]
    ret: MessageItem[]
  }
  'messages:search': {
    args: [{ accountId: string; query: string }]
    ret: Array<MessageItem & { chatName: string }>
  }
  'messages:send-text': {
    args: [{ accountId: string; jid: string; text: string; quotedId?: string | null }]
    ret: void
  }
  'messages:send-file': {
    args: [
      {
        accountId: string
        jid: string
        file: OutgoingFile
        caption?: string
        asDocument?: boolean
        voice?: boolean
        quotedId?: string | null
      }
    ]
    ret: void
  }
  'messages:send-location': {
    args: [{ accountId: string; jid: string; lat: number; lng: number; name?: string; address?: string }]
    ret: void
  }
  'messages:send-contact': { args: [{ accountId: string; jid: string; name: string; phone: string }]; ret: void }
  'messages:send-poll': {
    args: [{ accountId: string; jid: string; name: string; options: string[]; multiple: boolean }]
    ret: void
  }
  'messages:react': { args: [{ accountId: string; jid: string; id: string; emoji: string }]; ret: void }
  'messages:delete': { args: [{ accountId: string; jid: string; id: string }]; ret: void }
  'messages:edit': { args: [{ accountId: string; jid: string; id: string; text: string }]; ret: void }
  'media:get': { args: [{ accountId: string; jid: string; id: string }]; ret: MediaInfo }
  'media:save-as': { args: [{ accountId: string; jid: string; id: string }]; ret: void }
  'sync:state': { args: [{ accountId: string }]; ret: SyncState }
  'avatars:get': { args: [{ accountId: string; jids: string[] }]; ret: Record<string, string | null> }
  'transcribe:message': { args: [{ accountId: string; jid: string; id: string }]; ret: string }
  'transcribe:status': { args: []; ret: TranscribeStatus }
  'transcribe:save': { args: [{ mode?: TranscribeMode; engine?: TranscribeEngine }]; ret: TranscribeStatus }
  'transcribe:pick': { args: [{ what: 'whisper' | 'model' | 'ffmpeg' }]; ret: TranscribeStatus }
  'chats:new': { args: [{ accountId: string; phone: string }]; ret: string }

  // Contatos
  'people:list': {
    args: [
      {
        accountId: string
        search?: string
        tag?: string | null
        optOut?: 'all' | 'only' | 'exclude'
        limit: number
        offset: number
      }
    ]
    ret: { items: Person[]; total: number }
  }
  'people:tags': { args: [{ accountId: string }]; ret: Array<{ tag: string; count: number; color: string }> }
  'people:fields': { args: [{ accountId: string }]; ret: string[] }
  'people:save': {
    args: [
      {
        accountId: string
        id?: number
        name: string
        phone: string
        birthday?: string | null
        fields?: Record<string, string>
        tags?: string[]
      }
    ]
    ret: Person
  }
  'people:delete': { args: [{ accountId: string; ids: number[] }]; ret: void }
  'people:opt-out': { args: [{ accountId: string; ids: number[]; value: boolean }]; ret: void }
  'people:tag': { args: [{ accountId: string; ids: number[]; tag: string; add: boolean }]; ret: void }
  'people:import-preview': { args: [{ data: Uint8Array; sheet?: string }]; ret: ImportPreview }
  'people:import': {
    args: [{ accountId: string; token: string; mapping: ImportMapping; tags: string[] }]
    ret: ImportResult
  }
  'people:export': { args: [{ accountId: string }]; ret: void }

  // Etiquetas
  'tags:list': { args: [{ accountId: string }]; ret: TagDef[] }
  'tags:save': {
    args: [
      { accountId: string; name: string; color: TagColor; description?: string | null; previousName?: string | null }
    ]
    ret: TagDef
  }
  'tags:delete': { args: [{ accountId: string; name: string }]; ret: void }

  // Funis (kanban)
  'pipelines:list': { args: [{ accountId: string }]; ret: Pipeline[] }
  'pipelines:save': {
    args: [{ accountId: string; id?: number; name: string; color: TagColor; stages: PipelineStageInput[] }]
    ret: Pipeline
  }
  'pipelines:create-template': { args: [{ accountId: string; templateId: string; name?: string }]; ret: Pipeline }
  'pipelines:delete': { args: [{ accountId: string; id: number }]; ret: void }
  'pipelines:reorder': { args: [{ accountId: string; ids: number[] }]; ret: void }
  'pipelines:board': {
    args: [{ accountId: string; pipelineId: number; search?: string; tags?: string[] }]
    ret: PipelineBoard
  }
  'pipelines:move-card': { args: [{ accountId: string; cardId: number; stageId: number; index: number }]; ret: void }
  'pipelines:update-card': {
    args: [{ accountId: string; cardId: number; valueCents?: number; note?: string | null }]
    ret: void
  }
  'pipelines:remove-cards': { args: [{ accountId: string; cardIds: number[] }]; ret: void }
  'pipelines:add-people': {
    args: [{ accountId: string; stageId: number; personIds: number[]; move?: boolean }]
    ret: { added: number; moved: number; already: number }
  }
  'pipelines:add-by-tags': {
    args: [{ accountId: string; stageId: number; tags: string[] }]
    ret: { added: number; moved: number; already: number }
  }
  'pipelines:add-chat': { args: [{ accountId: string; stageId: number; chatJid: string }]; ret: CardPlacement[] }
  'pipelines:chat-profile': {
    args: [{ accountId: string; chatJid: string }]
    ret: { personId: number | null; tags: string[]; placements: CardPlacement[] }
  }
  'pipelines:chat-tags': { args: [{ accountId: string; chatJid: string; tags: string[] }]; ret: string[] }
  'pipelines:person': { args: [{ accountId: string; personId: number }]; ret: CardPlacement[] }

  // Robô de atendimento com IA
  'robot:settings-get': { args: [{ accountId: string }]; ret: RobotSettings }
  'robot:settings-save': { args: [{ accountId: string; patch: Partial<RobotSettings> }]; ret: RobotSettings }
  'robot:chat-get': { args: [{ accountId: string; jid: string }]; ret: ChatAiState | null }
  'robot:chat-assume': { args: [{ accountId: string; jid: string }]; ret: ChatAiState }
  'robot:chat-give-back': { args: [{ accountId: string; jid: string }]; ret: ChatAiState }
  'robot:chat-extra': { args: [{ accountId: string; jid: string; extra: string }]; ret: ChatAiState }

  // Recuperação de vendas com desconto
  'recovery:settings-get': { args: [{ accountId: string }]; ret: RecoverySettings }
  'recovery:settings-save': {
    args: [{ accountId: string; patch: Partial<RecoverySettings> }]
    ret: RecoverySettings
  }
  'recovery:queue': { args: [{ accountId: string }]; ret: RecoveryQueueItem[] }
  'recovery:approve': { args: [{ accountId: string; id: number; text?: string }]; ret: void }
  'recovery:discard': { args: [{ accountId: string; id: number }]; ret: void }
  'recovery:followups': { args: [{ accountId: string }]; ret: RecoveryFollowupItem[] }
  'recovery:stop': { args: [{ accountId: string; id: number }]; ret: void }
  'recovery:stats': { args: [{ accountId: string; days: number }]; ret: RecoveryStats }

  // Notas do cliente e datas (alvo: o contato ou a conversa dele)
  'notes:list': {
    args: [{ accountId: string; personId?: number; chatJid?: string }]
    ret: { personId: number | null; notes: ContactNote[] }
  }
  'notes:save': {
    args: [{ accountId: string; personId?: number; chatJid?: string; note: NoteInput }]
    ret: ContactNote
  }
  'notes:pin': { args: [{ accountId: string; id: number; pinned: boolean }]; ret: void }
  'notes:delete': { args: [{ accountId: string; id: number }]; ret: void }
  'notes:map': { args: [{ accountId: string; personId?: number; chatJid?: string }]; ret: ProfileMapResult }
  'dates:info': {
    args: [{ accountId: string; personId?: number; chatJid?: string }]
    ret: { personId: number | null; history: DateHistoryItem[]; suggestion: BirthdaySuggestion | null }
  }
  'dates:birthday-set': { args: [{ accountId: string; personId: number; birthday: string }]; ret: string }
  'dates:suggestion-dismiss': { args: [{ accountId: string; personId: number }]; ret: void }

  // Campanhas
  'antiban:get': { args: [{ accountId: string }]; ret: AntiBanSettings }
  'antiban:set': { args: [{ accountId: string; patch: Partial<AntiBanSettings> }]; ret: AntiBanSettings }
  'campaigns:list': { args: [{ accountId: string }]; ret: Campaign[] }
  'campaigns:get': { args: [{ id: number }]; ret: Campaign }
  'campaigns:save': {
    args: [
      {
        id?: number
        accountId: string
        name: string
        templates: string[]
        audience: CampaignAudience
        optOutFooter: boolean
        scheduledAt: number | null
      }
    ]
    ret: Campaign
  }
  'campaigns:media': {
    args: [{ id: number; file: { name: string; mime: string; data: Uint8Array } | null }]
    ret: Campaign
  }
  'campaigns:audience-count': {
    args: [{ accountId: string; audience: CampaignAudience }]
    ret: { total: number; optedOut: number }
  }
  'campaigns:start': { args: [{ id: number }]; ret: Campaign }
  'campaigns:pause': { args: [{ id: number }]; ret: Campaign }
  'campaigns:cancel': { args: [{ id: number }]; ret: Campaign }
  'campaigns:retry': { args: [{ id: number }]; ret: Campaign }
  'campaigns:delete': { args: [{ id: number }]; ret: void }
  'campaigns:duplicate': { args: [{ id: number }]; ret: Campaign }
  'campaigns:targets': {
    args: [{ id: number; status: TargetStatus | 'all'; limit: number; offset: number }]
    ret: CampaignTarget[]
  }
  'campaigns:export': { args: [{ id: number }]; ret: void }
  'campaigns:test': { args: [{ accountId: string; templates: string[]; optOutFooter: boolean }]; ret: void }
  'engine:state': { args: [{ accountId: string }]; ret: EngineState }

  // Respostas automáticas
  'rules:list': { args: [{ accountId: string }]; ret: AutoRule[] }
  'rules:save': { args: [{ accountId: string; rule: Omit<AutoRule, 'id'> & { id?: number } }]; ret: AutoRule }
  'rules:delete': { args: [{ accountId: string; id: number }]; ret: void }

  // Grupos
  'groups:list': { args: [{ accountId: string; refresh?: boolean }]; ret: GroupInfo[] }
  'groups:extract': {
    args: [{ accountId: string; jids: string[] }]
    ret: { added: number; existing: number; withoutNumber: number }
  }
  'groups:create': {
    args: [
      {
        accountId: string
        subject: string
        description?: string
        phones?: string[]
        tag?: string
        adminsOnly?: boolean
      }
    ]
    ret: { jid: string; inviteLink: string | null; queued: number }
  }
  'groups:invite': { args: [{ accountId: string; jid: string }]; ret: string }
  'groups:rule-get': { args: [{ accountId: string; jid: string }]; ret: GroupRule }
  'groups:rule-save': { args: [{ accountId: string; jid: string; rule: GroupRule }]; ret: GroupRule }

  // Lembretes
  'reminders:list': { args: [{ accountId: string }]; ret: Reminder[] }
  'reminders:save': {
    args: [{ accountId: string; reminder: Omit<Reminder, 'id' | 'lastRunDay'> & { id?: number } }]
    ret: Reminder
  }
  'reminders:delete': { args: [{ accountId: string; id: number }]; ret: void }

  // Status do WhatsApp
  'status:list': { args: [{ accountId: string }]; ret: StatusPost[] }
  'status:create': {
    args: [
      {
        accountId: string
        kind: StatusKind
        text: string
        background?: string | null
        font?: number | null
        audience: StatusAudience
        scheduledAt: number | null
        media?: { name: string; mime: string; data: Uint8Array } | null
      }
    ]
    ret: StatusPost
  }
  'status:cancel': { args: [{ accountId: string; id: number }]; ret: StatusPost }
  'status:audience-count': {
    args: [{ accountId: string; audience: StatusAudience }]
    ret: { total: number; semWhatsapp: number; optedOut: number; large: boolean; limit: number }
  }
  'status:settings': { args: [{ accountId: string }]; ret: StatusSettings & { postedToday: number } }
  'status:settings-save': { args: [{ accountId: string; dailyLimit: number }]; ret: StatusSettings }
  'reminders:preview': { args: [{ accountId: string; id: number }]; ret: number }

  // Vendas
  'deals:save': {
    args: [
      {
        accountId: string
        chatJid: string
        status: 'won' | 'lost'
        amountCents: number
        product?: string
        payment?: string
        reason?: string
        note?: string
      }
    ]
    ret: Deal
  }
  'deals:list': { args: [{ accountId: string; chatJid?: string; from?: number; to?: number }]; ret: Deal[] }
  'deals:delete': { args: [{ accountId: string; id: number }]; ret: void }
  'deals:summary': { args: [{ accountId: string; from: number; to: number }]; ret: SalesSummary }
  'painel:data': { args: [PanelQuery]; ret: PanelData }

  // Planilha de leads
  'leads:config': { args: [{ accountId: string }]; ret: LeadsConfig }
  'leads:config-save': { args: [{ accountId: string } & LeadsConfigInput]; ret: LeadsConfig }
  'leads:sync': { args: [{ accountId: string }]; ret: LeadsSyncResult }
  'leads:list': {
    args: [{ accountId: string; from?: number; to?: number; limit?: number; offset?: number }]
    ret: { items: LeadItem[]; total: number }
  }
  'leads:report': { args: [{ accountId: string; from?: number; to?: number }]; ret: LeadsReport }
  'leads:report-export': {
    args: [{ accountId: string; dimension: LeadsDimension; from?: number; to?: number }]
    ret: void
  }

  // IA
  'ai:providers': { args: []; ret: AiProvider[] }
  'ai:provider-save': {
    args: [
      {
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
      }
    ]
    ret: AiProvider
  }
  'ai:provider-delete': { args: [{ id: number }]; ret: void }
  'ai:provider-test': { args: [{ id: number }]; ret: string }
  'ai:settings': { args: []; ret: AiSettings }
  'ai:settings-save': { args: [Partial<AiSettings>]; ret: AiSettings }
  'ai:log': { args: []; ret: AiUsageEntry[] }
  'ai:suggest': { args: [{ accountId: string; jid: string; goal?: string }]; ret: { text: string; provider: string } }
  'ai:variations': { args: [{ accountId: string; base: string; count: number; brief?: string }]; ret: string[] }
  'ai:playbook': { args: [{ accountId: string }]; ret: { content: string; updatedAt: number } | null }
  'ai:playbook-build': { args: [{ accountId: string }]; ret: string }
  'ai:playbook-save': { args: [{ accountId: string; content: string }]; ret: void }
  'ai:context-get': { args: [{ accountId: string }]; ret: BusinessContext }
  'ai:context-save': { args: [{ accountId: string; context: Partial<BusinessContext> }]; ret: BusinessContext }
  'ai:context-fill': { args: [{ accountId: string; text: string }]; ret: Partial<BusinessContext> }
  'ai:local-status': { args: []; ret: LocalAiStatus }
  'ai:local-install': { args: [{ tier: 'leve' | 'medio' }]; ret: LocalAiStatus }
  'ai:local-cancel': { args: []; ret: void }
  'ai:local-medium-off': { args: []; ret: LocalAiStatus }
  'ai:local-remove': { args: []; ret: LocalAiStatus }

  'backup:get': { args: []; ret: BackupSettings }
  'backup:update': {
    args: [{ frequency?: BackupSettings['frequency']; keep?: number }]
    ret: BackupSettings
  }
  'backup:choose-folder': { args: []; ret: BackupSettings }
  'backup:set-password': { args: [{ password: string }]; ret: BackupSettings }
  'backup:run': { args: []; ret: string }
  'backup:list': { args: []; ret: BackupFile[] }
  'backup:restore': { args: [{ name?: string; password: string }]; ret: void }
}

export type ApiChannel = keyof ApiMap

// Eventos (processo principal → interface)
export interface EventMap {
  'license:changed': LicenseStatus
  'account:state': AccountState
  'wa:version': WaVersionInfo
  'backup:done': BackupSettings
  'update:changed': UpdateStatus
  'chats:changed': { accountId: string; chats: ChatItem[] }
  'messages:changed': { accountId: string; chatJid: string; messages: MessageItem[] }
  'messages:reload': { accountId: string; chatJid: string }
  'chats:merged': { accountId: string; from: string; to: string }
  'sync:changed': SyncState
  'nav:open-chat': { accountId: string; jid: string }
  'nav:open-recovery': { accountId: string }
  'engine:changed': EngineState
  'campaign:changed': Campaign
  'groups:progress': {
    accountId: string
    jid: string
    done: number
    total: number
    blocked: number
    finished?: boolean
  }
  'ai:progress': { accountId: string; done: number; total: number }
  'ai:local-progress': LocalAiProgress | null
  'avatars:changed': { accountId: string; avatars: Record<string, string | null> }
  'status:changed': { accountId: string }
  'robot:changed': { accountId: string; jid: string }
  'recovery:changed': { accountId: string }
}
export type EventChannel = keyof EventMap

export const API_CHANNELS: ApiChannel[] = [
  'app:info',
  'app:open-data-folder',
  'license:status',
  'license:activate',
  'license:remove',
  'license:login',
  'license:logout',
  'license:refresh',
  'app:open-site',
  'novidades:pendentes',
  'novidades:vistas',
  'update:status',
  'update:check',
  'update:download',
  'update:install',
  'wa:version',
  'wa:refresh-version',
  'accounts:list',
  'accounts:states',
  'accounts:create',
  'accounts:update',
  'accounts:delete',
  'accounts:connect',
  'accounts:disconnect',
  'accounts:logout',
  'chats:list',
  'chats:get',
  'chats:read',
  'chats:unread-total',
  'chats:new',
  'messages:list',
  'messages:search',
  'messages:send-text',
  'messages:send-file',
  'messages:send-location',
  'messages:send-contact',
  'messages:send-poll',
  'messages:react',
  'messages:delete',
  'messages:edit',
  'media:get',
  'media:save-as',
  'sync:state',
  'avatars:get',
  'transcribe:message',
  'transcribe:status',
  'transcribe:save',
  'transcribe:pick',
  'people:list',
  'people:tags',
  'people:fields',
  'people:save',
  'people:delete',
  'people:opt-out',
  'people:tag',
  'people:import-preview',
  'people:import',
  'people:export',
  'tags:list',
  'tags:save',
  'tags:delete',
  'pipelines:list',
  'pipelines:save',
  'pipelines:create-template',
  'pipelines:delete',
  'pipelines:reorder',
  'pipelines:board',
  'pipelines:move-card',
  'pipelines:update-card',
  'pipelines:remove-cards',
  'pipelines:add-people',
  'pipelines:add-by-tags',
  'pipelines:add-chat',
  'pipelines:chat-profile',
  'pipelines:chat-tags',
  'pipelines:person',
  'robot:settings-get',
  'robot:settings-save',
  'robot:chat-get',
  'robot:chat-assume',
  'robot:chat-give-back',
  'robot:chat-extra',
  'recovery:settings-get',
  'recovery:settings-save',
  'recovery:queue',
  'recovery:approve',
  'recovery:discard',
  'recovery:followups',
  'recovery:stop',
  'recovery:stats',
  'notes:list',
  'notes:save',
  'notes:pin',
  'notes:delete',
  'notes:map',
  'dates:info',
  'dates:birthday-set',
  'dates:suggestion-dismiss',
  'antiban:get',
  'antiban:set',
  'campaigns:list',
  'campaigns:get',
  'campaigns:save',
  'campaigns:media',
  'campaigns:audience-count',
  'campaigns:start',
  'campaigns:pause',
  'campaigns:cancel',
  'campaigns:retry',
  'campaigns:delete',
  'campaigns:duplicate',
  'campaigns:targets',
  'campaigns:export',
  'campaigns:test',
  'engine:state',
  'rules:list',
  'rules:save',
  'rules:delete',
  'groups:list',
  'groups:extract',
  'groups:create',
  'groups:invite',
  'groups:rule-get',
  'groups:rule-save',
  'reminders:list',
  'reminders:save',
  'reminders:delete',
  'reminders:preview',
  'status:list',
  'status:create',
  'status:cancel',
  'status:audience-count',
  'status:settings',
  'status:settings-save',
  'deals:save',
  'deals:list',
  'deals:delete',
  'deals:summary',
  'painel:data',
  'leads:config',
  'leads:config-save',
  'leads:sync',
  'leads:list',
  'leads:report',
  'leads:report-export',
  'ai:providers',
  'ai:provider-save',
  'ai:provider-delete',
  'ai:provider-test',
  'ai:settings',
  'ai:settings-save',
  'ai:log',
  'ai:suggest',
  'ai:variations',
  'ai:playbook',
  'ai:playbook-build',
  'ai:playbook-save',
  'ai:context-get',
  'ai:context-save',
  'ai:context-fill',
  'ai:local-status',
  'ai:local-install',
  'ai:local-cancel',
  'ai:local-medium-off',
  'ai:local-remove',
  'backup:get',
  'backup:update',
  'backup:choose-folder',
  'backup:set-password',
  'backup:run',
  'backup:list',
  'backup:restore'
]
export const EVENT_CHANNELS: EventChannel[] = [
  'license:changed',
  'account:state',
  'wa:version',
  'backup:done',
  'update:changed',
  'chats:changed',
  'messages:changed',
  'messages:reload',
  'chats:merged',
  'sync:changed',
  'nav:open-chat',
  'nav:open-recovery',
  'engine:changed',
  'campaign:changed',
  'groups:progress',
  'ai:progress',
  'ai:local-progress',
  'avatars:changed',
  'status:changed',
  'robot:changed',
  'recovery:changed'
]

export interface BridgeApi {
  invoke<C extends ApiChannel>(channel: C, ...args: ApiMap[C]['args']): Promise<ApiMap[C]['ret']>
  on<E extends EventChannel>(event: E, cb: (payload: EventMap[E]) => void): () => void
}
