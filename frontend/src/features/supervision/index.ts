/**
 * Public API of the supervision feature (slice 3 + slice 9): "Colas", "Equipo",
 * "Escalados", the supervisor's read-only case view, the reassign dialog behind them, the
 * rail badges, the notices and their realtime handlers. Depends on
 * `@/features/conversation` and `@/features/cases`. Everything in `./core` is
 * re-exported here; the app shell imports `core` only.
 */
export * from './core'
export { QueuesScreen } from './components/QueuesScreen'
export type { QueuesScreenProps } from './components/QueuesScreen'
export { TeamScreen } from './components/TeamScreen'
export type { TeamScreenProps } from './components/TeamScreen'
export { EscalationsScreen } from './components/EscalationsScreen'
export type { EscalationsScreenProps } from './components/EscalationsScreen'
export { SupervisorCaseScreen } from './components/SupervisorCaseScreen'
export type { SupervisorCaseScreenProps } from './components/SupervisorCaseScreen'
export { useSupervisionNotices } from './hooks'
export {
  ACTIVITY_META,
  backLabelFor,
  parseCaseViewSearch,
  parseEscalationsSearch,
  parseQueuesSearch,
  parseTeamSearch,
  toCaseViewSearch,
  toEscalationsSearch,
  toQueuesSearch,
  toTeamSearch,
} from './model'
export type {
  ActivityMeta,
  CaseViewUrlState,
  EscalationsUrlState,
  QueuesUrlState,
  TeamUrlState,
  UrlStateChangeOptions,
} from './model'
