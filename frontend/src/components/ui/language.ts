/**
 * The languages the platform serves and how the UI names them (pure, no React).
 *
 * A language is shown as a mark: a globe + code ("ES", "PT"), one globe per group
 * ("ES PT"), never the globe alone; a pt-BR customer shows PT. Where a name is shown
 * it is the language's own name ("Español", "Português"), never a translation of it.
 */
import { formatList } from '@/lib/format'

/** The API's `Language` values. */
export type LanguageCode = 'es' | 'pt'

/** Canonical order: every list of languages is shown in this order. */
export const LANGUAGE_CODES: readonly LanguageCode[] = ['es', 'pt']

/** The code shown in a mark. */
export const LANGUAGE_MARK_CODE: Record<LanguageCode, string> = { es: 'ES', pt: 'PT' }

/** Each language's own name (the tooltip and screen-reader name of its mark). */
export const LANGUAGE_NATIVE_NAME: Record<LanguageCode, string> = {
  es: 'Español', // i18n-ignore: a language's own name, the same in every UI language
  pt: 'Português', // i18n-ignore
}

/** The known languages of a list, once each, in canonical order. */
export function sortLanguages(languages: readonly string[]): LanguageCode[] {
  return LANGUAGE_CODES.filter((language) => languages.includes(language))
}

/**
 * "Español", "Español y Português" ("Español e Português" in a Portuguese UI); "" for none.
 * The name of a group of marks.
 */
export function languagesName(languages: readonly string[]): string {
  return formatList(sortLanguages(languages).map((language) => LANGUAGE_NATIVE_NAME[language]))
}
