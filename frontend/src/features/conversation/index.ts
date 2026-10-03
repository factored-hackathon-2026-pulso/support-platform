/**
 * Public API of the conversation feature: the Workspace conversation for one
 * case, "Casos anteriores de este cliente", the shared case-detail query and its
 * realtime handlers (docs/platform/api/slice-2-case-lifecycle.md §9.7). Depends
 * only on `@/features/cases`.
 */
export { ConversationPane } from './components/ConversationPane'
export type { ConversationPaneProps } from './components/ConversationPane'
export { CaseHistorySheet } from './components/CaseHistorySheet'
export type { CaseHistorySheetProps } from './components/CaseHistorySheet'
export { useCaseDetail } from './hooks/use-case-detail'
export { conversationKeys } from './api'
export { registerConversationRealtime } from './realtime'
export type { CaseCustomer, CaseDetail, CaseHistory, CaseHistoryItem, Turn } from './types'
