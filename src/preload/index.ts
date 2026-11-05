import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { API_CHANNELS, EVENT_CHANNELS, type BridgeApi, type ApiChannel, type EventChannel } from '@shared/api'
import type { Result } from '@shared/types'

// Ponte mínima: só canais da lista branca, nunca o ipcRenderer cru.
const api: BridgeApi = {
  async invoke(channel: ApiChannel, ...args: unknown[]) {
    if (!API_CHANNELS.includes(channel)) throw new Error('Canal não permitido')
    const r = (await ipcRenderer.invoke(channel, ...args)) as Result<unknown>
    if (!r.ok) throw new Error(r.error)
    return r.data as never
  },
  on(event: EventChannel, cb: (payload: never) => void) {
    if (!EVENT_CHANNELS.includes(event)) throw new Error('Evento não permitido')
    const handler = (_e: IpcRendererEvent, payload: unknown): void => cb(payload as never)
    ipcRenderer.on(event, handler)
    return () => ipcRenderer.removeListener(event, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
