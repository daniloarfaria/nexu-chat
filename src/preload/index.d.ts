import type { BridgeApi } from '../shared/api'

declare global {
  interface Window {
    api: BridgeApi
    ui: { setFocusedChat(v: { accountId: string; jid: string } | null): void }
  }
}
