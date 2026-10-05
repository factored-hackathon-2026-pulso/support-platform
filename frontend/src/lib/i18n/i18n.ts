/**
 * The i18next instance of the SPA (slice 23, ADR 0008).
 *
 * - Catalogs: `src/locales/<locale>/<namespace>.ts`. `common` and `shell` (both locales) are
 *   bundled with the entry chunk; every other namespace is its own lazy chunk, loaded by the
 *   backend below on first use and prefetched in the background (`prefetchNamespaces`).
 * - No fallback language: `pt-BR` has every key (a compile error otherwise), so a missing
 *   key can only be a bug, never a silent Spanish string.
 * - `{{count, number}}` uses the app's number format (`lib/format`: "4.412").
 * - Every language change updates the active locale (formatters), `<html lang>`.
 */
import i18next, { type BackendModule, type ResourceKey } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { formatNumber } from '@/lib/format'
import { EAGER_NAMESPACES, NAMESPACES, type Namespace } from '@/locales/namespaces'
import commonEs from '@/locales/es/common'
import shellEs from '@/locales/es/shell'
import commonPt from '@/locales/pt-BR/common'
import shellPt from '@/locales/pt-BR/shell'
import {
  APP_LOCALES,
  DEFAULT_LOCALE,
  detectInitialLocale,
  isAppLocale,
  setActiveLocale,
  type AppLocale,
} from './locale'

type CatalogModule = { default: ResourceKey }

/** Lazy catalogs: one chunk per locale and namespace (the eager ones are excluded). */
const LAZY_CATALOGS = import.meta.glob<CatalogModule>([
  '../../locales/*/*.ts',
  '!../../locales/*/common.ts',
  '!../../locales/*/shell.ts',
])

function catalogPath(locale: string, namespace: string): string {
  return `../../locales/${locale}/${namespace}.ts`
}

/** Reads a lazy catalog chunk (i18next backend plugin). */
const lazyCatalogs: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read(language, namespace, callback) {
    const load = LAZY_CATALOGS[catalogPath(language, namespace)]
    if (!load) {
      callback(new Error(`No catalog for ${language}/${namespace}`), false)
      return
    }
    load().then(
      (module) => callback(null, module.default),
      (error: unknown) => callback(error instanceof Error ? error : String(error), false),
    )
  },
}

function syncDocument(locale: AppLocale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

export const i18n = i18next.createInstance()

i18n
  .use(lazyCatalogs)
  .use(initReactI18next)
  .init({
    lng: detectInitialLocale(),
    supportedLngs: APP_LOCALES,
    load: 'currentOnly',
    fallbackLng: false,
    ns: [...EAGER_NAMESPACES],
    defaultNS: 'common',
    partialBundledLanguages: true,
    resources: {
      es: { common: commonEs, shell: shellEs },
      'pt-BR': { common: commonPt, shell: shellPt },
    },
    initAsync: false,
    returnNull: false,
    interpolation: { escapeValue: false }, // React escapes
    react: { useSuspense: true, bindI18n: 'languageChanged' },
  })
  .catch((error: unknown) => {
    console.error('i18n init failed', error)
  })

i18n.services.formatter?.add('number', (value: unknown, lng) =>
  typeof value === 'number'
    ? formatNumber(value, { locale: isAppLocale(lng) ? lng : DEFAULT_LOCALE })
    : String(value),
)

function onLanguageChanged(language: string): void {
  const locale = isAppLocale(language) ? language : DEFAULT_LOCALE
  setActiveLocale(locale)
  syncDocument(locale)
}

onLanguageChanged(i18n.language)
i18n.on('languageChanged', onLanguageChanged)

/** The UI locale i18next speaks now. */
export function currentLocale(): AppLocale {
  return isAppLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE
}

/** Switch the UI language; resolves once its catalogs in use are loaded. */
export async function changeLocale(locale: AppLocale): Promise<void> {
  if (i18n.language === locale) return
  await i18n.changeLanguage(locale)
}

/** Load namespaces of the current language ahead of their screens (no suspense later). */
export function prefetchNamespaces(namespaces: readonly Namespace[] = NAMESPACES): Promise<void> {
  return i18n.loadNamespaces([...namespaces])
}

/** Load every namespace of every locale (tests: nothing suspends, any locale renders at once). */
export async function loadAllCatalogs(): Promise<void> {
  await Promise.all(
    APP_LOCALES.flatMap((locale) =>
      NAMESPACES.map(async (namespace) => {
        if (i18n.hasResourceBundle(locale, namespace)) return
        const load = LAZY_CATALOGS[catalogPath(locale, namespace)]
        if (!load) throw new Error(`No catalog for ${locale}/${namespace}`)
        const module = await load()
        i18n.addResourceBundle(locale, namespace, module.default, true, true)
      }),
    ),
  )
  await i18n.loadNamespaces([...NAMESPACES])
}
