export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const d = raw.replace(/\D/g, '')
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d)
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : '+' + d
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} MB`
}

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return 'nunca'
  const diff = (ts - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return 'agora'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
