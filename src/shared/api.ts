import type {
  Account,
  AccountState,
  AppInfo,
  BackupFile,
  BackupSettings,
  Modules,
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
  'backup:get',
  'backup:update',
  'backup:choose-folder',
  'backup:set-password',
  'backup:run',
  'backup:list',
  'backup:restore'
]
export const EVENT_CHANNELS: EventChannel[] = ['account:state', 'wa:version', 'backup:done', 'update:changed']

export interface BridgeApi {
  invoke<C extends ApiChannel>(channel: C, ...args: ApiMap[C]['args']): Promise<ApiMap[C]['ret']>
  on<E extends EventChannel>(event: E, cb: (payload: EventMap[E]) => void): () => void
}
