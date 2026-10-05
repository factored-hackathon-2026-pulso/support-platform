/**
 * The two languages of the customer simulator (slice 23, ADR 0008):
 *
 * - Inside the phone frame (chat, call, email, assistant, survey) it speaks the **customer's**
 *   language (`es` | `pt`), whatever the UI language is: `customerT(language)` is the
 *   `customer` catalog fixed to that locale, read when the function runs.
 * - The page around it (header, customer and channel pickers) is dev chrome in the UI
 *   language: `chromeT`, which follows the active locale at call time.
 *
 * Both catalogs must be loaded before the phone frame renders: `useCustomerCatalogs`
 * (hooks) loads them once when the simulator mounts.
 */
import { i18n, type AppLocale } from '@/lib/i18n'
import type { Language } from './types'

/** The customer's language as a catalog locale (and the frame's `lang`): pt → pt-BR. */
export function customerLocale(language: Language): AppLocale {
  return language === 'pt' ? 'pt-BR' : 'es'
}

/** A UI locale as a customer language (the chrome reuses the customer copy of a failure). */
export function languageOfLocale(locale: AppLocale): Language {
  return locale === 'pt-BR' ? 'pt' : 'es'
}

/** The `customer` catalog in the customer's language. */
export function customerT(language: Language) {
  return i18n.getFixedT(customerLocale(language), 'customer')
}

/** The `customer` catalog in the UI language (the simulator chrome). */
export const chromeT = i18n.getFixedT(null, 'customer')
