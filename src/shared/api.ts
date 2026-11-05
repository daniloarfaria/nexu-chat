import type {
  Account,
  AccountState,
  AppInfo,
  BackupFile,
  BackupSettings,
  Modules,
  ChatFilter,
  ChatItem,
  MediaInfo,
  MessageItem,
  OutgoingFile,
  SyncState,
  UpdateStatus,
  WaVersionInfo
} from './types'

// Mapa tipado de todos os canais IPC (interface → processo principal).
export interface ApiMap {
  'app:info': { args: []; ret: AppInfo }
  'app:open-data-folder': { args: []; ret: void }
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
    args: [{ accountId: string; jid: string; before: number | null; limit: number }]
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
  'chats:new': { args: [{ accountId: string; phone: string }]; ret: string }

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
}
export type EventChannel = keyof EventMap

export const API_CHANNELS: ApiChannel[] = [
  'app:info',
  'app:open-data-folder',
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
  'backup:get',
  'backup:update',
  'backup:choose-folder',
  'backup:set-password',
  'backup:run',
  'backup:list',
  'backup:restore'
]
export const EVENT_CHANNELS: EventChannel[] = [
  'account:state',
  'wa:version',
  'backup:done',
  'update:changed',
  'chats:changed',
  'messages:changed',
  'messages:reload',
  'chats:merged',
  'sync:changed',
  'nav:open-chat'
]

export interface BridgeApi {
  invoke<C extends ApiChannel>(channel: C, ...args: ApiMap[C]['args']): Promise<ApiMap[C]['ret']>
  on<E extends EventChannel>(event: E, cb: (payload: EventMap[E]) => void): () => void
}
