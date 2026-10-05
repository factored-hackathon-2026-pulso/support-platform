import 'i18next'
import type { Resources } from '@/locales/namespaces'

// Type-safe keys (slice 23): `t('login.title')` in `useTranslation('auth')` is checked against
// the Spanish source; a missing key or a wrong interpolation value is a compile error.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: Resources
    returnNull: false
  }
}
