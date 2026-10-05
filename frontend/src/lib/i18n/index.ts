export {
  APP_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_CODE,
  LOCALE_NAME,
  detectInitialLocale,
  getActiveLocale,
  isAppLocale,
  localeFromBrowser,
  readStoredLocale,
  storeLocale,
  type AppLocale,
} from './locale'
export type { Translation } from './catalog'
export { changeLocale, currentLocale, i18n, loadAllCatalogs, prefetchNamespaces } from './i18n'
export { useActiveLocale } from './react'
export { Trans, useTranslation } from 'react-i18next'
