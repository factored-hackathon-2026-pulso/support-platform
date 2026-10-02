/**
 * Public API of the conversation feature: the Workspace centre column for one
 * case, "Cómo llegó a ti", the shared case-detail query and its realtime
 * handlers (docs/platform/api/slice-1-cases.md §7.2). Depends only on
 * `@/features/cases`.
 */
export { ConversationPane } from './components/ConversationPane'
export type { ConversationPaneProps } from './components/ConversationPane'
export { RoutingSummary } from './components/RoutingSummary'
export type { RoutingSummaryProps } from './components/RoutingSummary'
export { useCaseDetail } from './hooks/use-case-detail'
export { conversationKeys } from './api'
export { registerConversationRealtime } from './realtime'
export type {
  CaseDetail,
  CustomerProfile,
  RouteStop,
  RoutingSummary as RoutingSummaryData,
  Turn,
} from './types'
