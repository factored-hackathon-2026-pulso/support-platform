/**
 * Public API of the supervision feature: Equipo y colas, the supervisor's
 * read-only case view, the assign dialog behind both, the queued-cases badge,
 * the queue notice and their realtime handlers
 * (docs/platform/api/slice-3-supervision.md §8.10). Depends on
 * `@/features/conversation` and `@/features/cases`.
 */
export { TeamScreen } from './components/TeamScreen'
export type { TeamScreenProps } from './components/TeamScreen'
export { SupervisorCaseScreen } from './components/SupervisorCaseScreen'
export type { SupervisorCaseScreenProps } from './components/SupervisorCaseScreen'
export { useQueuedCasesCount, useQueueNotices } from './hooks'
export { supervisionKeys, supervisionMutationKeys } from './api'
export { registerSupervisionRealtime } from './realtime'
export { parseCaseViewSearch, parseTeamSearch, toCaseViewSearch, toTeamSearch } from './model'
export type { CaseViewUrlState, TeamUrlState, UrlStateChangeOptions } from './model'
export type {
  AnalystActivity,
  AssignmentResult,
  LanguageQueue,
  QueueCounts,
  QueueOverview,
  TeamAnalyst,
  TeamOverview,
  TeamSummary,
} from './types'
