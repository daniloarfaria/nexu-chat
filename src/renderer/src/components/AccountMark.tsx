import { useEffect, useState } from 'react'
import type { Account } from '@shared/types'
import { useAvatar, useAvatars } from '../lib/avatars'
import { useApp } from '../lib/store'
import { cn } from '../lib/cn'

/** Marca da conta: foto de perfil do próprio WhatsApp; sem foto ou desconectada, a inicial na cor da conta. */
export function AccountMark({
  account,
  size = 28,
  className
}: {
  account: Account
  size?: number
  className?: string
}): React.JSX.Element {
  const phone = useApp((s) => s.states[account.id]?.phone) ?? account.phone
  const jid = phone ? `${phone}@s.whatsapp.net` : null
  const url = useAvatar(account.id, jid)
  const connected = useApp((s) => s.states[account.id]?.status === 'connected')
  // A barra lateral aparece antes de conectar; ao conectar, pede a foto de novo
  useEffect(() => {
    if (!connected || !jid) return
    void window.api
      .invoke('avatars:get', { accountId: account.id, jids: [jid] })
      .then((m) => useAvatars.getState().set(account.id, m))
      .catch(() => undefined)
  }, [connected, jid, account.id])
  const [broken, setBroken] = useState<string | null>(null)
  const radius = Math.round(size * 0.25)
  if (url && broken !== url)
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        draggable={false}
        onError={() => setBroken(url)}
        className={cn('shrink-0 bg-sunken object-cover select-none', className)}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    )
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center font-semibold text-white select-none', className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: account.color,
        fontSize: Math.round(size * 0.42)
      }}
    >
      {account.name.slice(0, 1).toUpperCase()}
    </span>
  )
}
