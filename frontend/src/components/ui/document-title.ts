import { i18n } from '@/lib/i18n'

/** Product name shown after every page title in the browser tab (in the UI language). */
export function appTitle(): string {
  return i18n.t('appTitle')
}

/** "Entrar · LATAM Bank Soporte"; the bare product name when there is no page title. */
export function formatDocumentTitle(title?: string | null): string {
  const page = title?.trim()
  return page ? `${page} · ${appTitle()}` : appTitle()
}
