/** Product name shown after every page title in the browser tab. */
export const APP_TITLE = 'LATAM Bank Soporte'

/** "Entrar · LATAM Bank Soporte"; the bare product name when there is no page title. */
export function formatDocumentTitle(title?: string | null): string {
  const page = title?.trim()
  return page ? `${page} · ${APP_TITLE}` : APP_TITLE
}
