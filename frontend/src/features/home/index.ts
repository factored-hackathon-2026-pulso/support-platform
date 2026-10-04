/**
 * Public API of the home feature: the analyst home "Inicio"
 * (docs/platform/api/slice-6-analyst-home.md §4). Depends on `@/features/cases`
 * (inbox, availability, urgency order) and `@/features/conversation/core`
 * (types). Everything in `./core` is re-exported here; the app shell
 * imports `core` only.
 */
export * from './core'
export { HomeScreen } from './components/HomeScreen'
export { useHome } from './hooks'
