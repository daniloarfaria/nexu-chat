import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap
} from 'baileys'
import { getDb, transaction } from '../db'
import { seal, unseal } from '../secure'
import { log } from '../log'

const CREDS = '__creds__'

function encode(value: unknown): Buffer {
  return seal(Buffer.from(JSON.stringify(value, BufferJSON.replacer), 'utf8'))
}

function decode<T>(blob: Uint8Array): T {
  return JSON.parse(unseal(blob).toString('utf8'), BufferJSON.reviver) as T
}

/**
 * Sessão do WhatsApp guardada no SQLite, criptografada com a chave do sistema.
 * Se o banco veio de outro computador (backup restaurado), a sessão não abre
 * e a conta precisa ler o QR Code de novo.
 */
export function sqliteAuthState(accountId: string): {
  state: AuthenticationState
  saveCreds: () => void
  clear: () => void
} {
  const db = getDb()
  const sel = db.prepare('SELECT value FROM wa_auth WHERE account_id = ? AND category = ? AND key_id = ?')
  const ups = db.prepare(
    'INSERT INTO wa_auth (account_id, category, key_id, value) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(account_id, category, key_id) DO UPDATE SET value = excluded.value'
  )
  const del = db.prepare('DELETE FROM wa_auth WHERE account_id = ? AND category = ? AND key_id = ?')

  let creds: AuthenticationCreds
  const row = sel.get(accountId, CREDS, CREDS) as { value: Uint8Array } | undefined
  try {
    creds = row ? decode<AuthenticationCreds>(row.value) : initAuthCreds()
  } catch (e) {
    log.warn('Sessão salva não pôde ser aberta (outro computador?). Será preciso ler o QR Code.', {
      erro: (e as Error).message
    })
    db.prepare('DELETE FROM wa_auth WHERE account_id = ?').run(accountId)
    creds = initAuthCreds()
  }

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const out: { [id: string]: SignalDataTypeMap[T] } = {}
        for (const id of ids) {
          const r = sel.get(accountId, type, id) as { value: Uint8Array } | undefined
          if (!r) continue
          try {
            let value = decode<unknown>(r.value)
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object)
            }
            out[id] = value as SignalDataTypeMap[T]
          } catch {
            /* chave corrompida: ignora, o Baileys renegocia */
          }
        }
        return out
      },
      set: async (data) => {
        transaction(db, () => {
          for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
            const entries = data[category] ?? {}
            for (const id of Object.keys(entries)) {
              const value = entries[id]
              if (value) ups.run(accountId, category, id, encode(value))
              else del.run(accountId, category, id)
            }
          }
        })
      }
    }
  }

  return {
    state,
    saveCreds: () => {
      ups.run(accountId, CREDS, CREDS, encode(state.creds))
    },
    clear: () => {
      db.prepare('DELETE FROM wa_auth WHERE account_id = ?').run(accountId)
    }
  }
}
