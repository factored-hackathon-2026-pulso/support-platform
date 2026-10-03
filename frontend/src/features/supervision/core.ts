/**
 * Core public API of the supervision feature: what the always-loaded app shell
 * may import without pulling in any screen (ARCHITECTURE.md §3, "Two public
 * files"). The realtime handlers, the queued-cases count behind the rail badge,
 * the query keys and the types. No components and nothing that reaches one:
 * src/test/architecture.test.ts checks it.
 */
export { useQueuedCasesCount } from './hooks/use-overviews'
export { supervisionKeys, supervisionMutationKeys } from './api'
export { registerSupervisionRealtime } from './realtime'
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
