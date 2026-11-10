import type { Modules } from '@shared/types'

/** Páginas que a tela inicial pode usar, na ordem de preferência */
export type HomePage = 'conversas' | 'contatos'

/**
 * Decide a tela inicial. Conversas é o padrão. Sem número cadastrado (modules vazio) ela mostra o
 * "Conecte seu WhatsApp". Se o plano ou a licença desligou o módulo Conversas, cai em Contatos,
 * que não depende de módulo.
 */
export function homePage(modules: Modules | null | undefined): HomePage {
  if (!modules || modules.conversas) return 'conversas'
  return 'contatos'
}
