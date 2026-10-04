/**
 * Public API of the supervision feature: Equipo y colas, the supervisor's
 * read-only case view, the assign dialog behind both, the queued-cases badge,
 * the queue notice and their realtime handlers
 * (docs/platform/api/slice-3-supervision.md §8.10). Depends on
 * `@/features/conversation` and `@/features/cases`.
 * Everything in `./core` is re-exported here; the app shell imports `core` only.
 */
export * from './core'
export { TeamScreen } from './components/TeamScreen'
export type { TeamScreenProps } from './components/TeamScreen'
export { SupervisorCaseScreen } from './components/SupervisorCaseScreen'
export type { SupervisorCaseScreenProps } from './components/SupervisorCaseScreen'
export { useQueueNotices } from './hooks'
export {
  ACTIVITY_META,
  parseCaseViewSearch,
  parseTeamSearch,
  toCaseViewSearch,
  toTeamSearch,
} from './model'
export type { ActivityMeta, CaseViewUrlState, TeamUrlState, UrlStateChangeOptions } from './model'
