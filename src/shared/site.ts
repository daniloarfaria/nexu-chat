/** Site do Nexu Chat: licenças, downloads e novidades. */
export const NEXU_SITE = 'https://nexuchat.agenciaark.com.br'

/** Páginas do site que o app pode abrir no navegador. */
export const SITE_PAGES = {
  conta: '/conta',
  recuperar: '/conta/recuperar',
  teste: '/teste-gratis',
  planos: '/#planos',
  download: '/download',
  novidades: '/novidades'
} as const
export type SitePage = keyof typeof SITE_PAGES
