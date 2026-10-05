import { useSyncExternalStore } from 'react'
import { getActiveLocale, subscribeActiveLocale, type AppLocale } from './locale'

/**
 * The active UI locale, re-rendering on change. Components that show formatted values
 * (`lib/format`) without calling `useTranslation` read it so they follow a language switch.
 */
export function useActiveLocale(): AppLocale {
  return useSyncExternalStore(subscribeActiveLocale, getActiveLocale, getActiveLocale)
}
