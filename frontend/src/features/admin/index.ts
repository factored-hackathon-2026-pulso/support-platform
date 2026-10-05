/**
 * Public API of the administration feature: Usuarios y roles, Equipos, Plataforma
 * (slice 18: the AI switch), the locked-accounts badge and their realtime handlers
 * (docs/platform/api/slice-4-administration.md §10.12). Imports no other
 * feature (only `@/app/roles`, `@/app/platform`, `@/components/*`, `@/lib/*`).
 * Everything in `./core` is re-exported here; the app shell imports `core` only.
 */
export * from './core'
export { UsersScreen } from './components/UsersScreen'
export type { UsersScreenProps } from './components/UsersScreen'
export { PlatformScreen } from './components/PlatformScreen'
export { TeamsScreen } from './components/TeamsScreen'
export type { TeamsScreenProps } from './components/TeamsScreen'
export { ACCOUNT_STATUS, TEAM_STATUS, teamStatus } from './model'
export { parseTeamsSearch, parseUsersSearch, toTeamsSearch, toUsersSearch } from './url'
export type { TeamsUrlState, UrlStateChangeOptions, UsersUrlState } from './url'
