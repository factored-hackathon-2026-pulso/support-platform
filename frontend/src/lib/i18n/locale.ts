/**
 * The UI locale (slice 23): which language the staff app speaks. Framework-free, so the
 * formatters (`lib/format`) and pure model code read it without React.
 *
 * - `AppLocale` is a BCP 47 tag the backend stores as `uiLanguage` (`es` | `pt-BR`).
 * - The active locale is a tiny external store: i18next writes it on every language change
 *   (`lib/i18n/i18n.ts`); `getActiveLocale()` reads it anywhere.
 * - Before sign-in the app speaks the stored choice (`localStorage`, written whenever the
 *   person picks a language or her profile says one), else the browser's language when it is
 *   Spanish or Portuguese, else Spanish (`detectInitialLocale`).
 */

export const APP_LOCALES = ['es', 'pt-BR'] as const

export type AppLocale = (typeof APP_LOCALES)[number]

/** The source language: every key is written here first. */
export const DEFAULT_LOCALE: AppLocale = 'es'

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value)
}

/** Each locale by its own name, as the language menu shows it (never translated). */
export const LOCALE_NAME: Record<AppLocale, string> = {
  es: 'Español',
  'pt-BR': 'Português',
}

/** Short code for the language mark ("ES", "PT"). */
export const LOCALE_CODE: Record<AppLocale, string> = { es: 'ES', 'pt-BR': 'PT' }

const STORAGE_KEY = 'cc.ui-language'

type Listener = () => void

let active: AppLocale = DEFAULT_LOCALE
const listeners = new Set<Listener>()

export function getActiveLocale(): AppLocale {
  return active
}

/** Called by the i18n instance on every language change; formatters follow at once. */
export function setActiveLocale(locale: AppLocale): void {
  if (locale === active) return
  active = locale
  for (const listener of listeners) listener()
}

export function subscribeActiveLocale(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The locale this browser last used (a person's pick or her profile), if any. */
export function readStoredLocale(): AppLocale | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
    return isAppLocale(value) ? value : null
  } catch {
    // Storage can be blocked (privacy mode): the browser language decides.
    return null
  }
}

export function storeLocale(locale: AppLocale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale)
  } catch {
    // See readStoredLocale.
  }
}

/** The first browser language that is Spanish or Portuguese, mapped to an app locale. */
export function localeFromBrowser(languages: readonly string[]): AppLocale | null {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split('-')[0]
    if (primary === 'es') return 'es'
    if (primary === 'pt') return 'pt-BR'
  }
  return null
}

/** Pre-login language: the stored choice, else the browser's (es / pt), else Spanish. */
export function detectInitialLocale(
  stored: AppLocale | null = readStoredLocale(),
  languages: readonly string[] = browserLanguages(),
): AppLocale {
  return stored ?? localeFromBrowser(languages) ?? DEFAULT_LOCALE
}

function browserLanguages(): readonly string[] {
  const nav = globalThis.navigator as Navigator | undefined
  if (!nav) return []
  if (nav.languages && nav.languages.length > 0) return nav.languages
  return nav.language ? [nav.language] : []
}
