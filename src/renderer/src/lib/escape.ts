/**
 * Esc dentro de algo que está aberto por cima da janela (seletor de reação, menu de anexo,
 * formulário extra do compositor): fecha só esse item e não deixa o Esc chegar à janela em volta.
 * Devolve true quando tratou o Esc.
 */
export function escapeInner(e: { key: string; stopPropagation: () => void }, isOpen: boolean, close: () => void): boolean {
  if (e.key !== 'Escape' || !isOpen) return false
  e.stopPropagation()
  close()
  return true
}

/** Fecha a janela; se há algo não salvo, só fecha depois de a pessoa confirmar. */
export function guardedClose(isDirty: () => boolean, ask: () => boolean, close: () => void): void {
  if (isDirty() && !ask()) return
  close()
}
