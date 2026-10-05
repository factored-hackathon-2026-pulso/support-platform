import { useTranslation } from '@/lib/i18n'

// Module constants: `useTranslation` memoises its options by identity.
const SPANISH = { lng: 'es' } as const
const PORTUGUESE = { lng: 'pt-BR' } as const

/**
 * Loads the `customer` catalog in both customer languages before the simulator renders
 * (it suspends once, on mount): the phone frame speaks the customer's language whatever the
 * UI language is, and its copy is read with `customerT` (locale.ts), which never loads.
 */
export function useCustomerCatalogs(): void {
  useTranslation('customer', SPANISH)
  useTranslation('customer', PORTUGUESE)
}
