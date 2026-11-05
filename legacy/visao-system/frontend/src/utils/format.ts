export function formatBRL(value: number | null | undefined): string {
  if (value == null) return 'R$ —';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function formatPct(value: number | null | undefined): string {
  if (value == null) return '—%';
  return `${Number(value).toFixed(1)}%`;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function formatMarkup(value: number | null | undefined): string {
  if (value == null) return '—x';
  return `${Number(value).toFixed(2)}x`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('pt-BR').format(value);
}
