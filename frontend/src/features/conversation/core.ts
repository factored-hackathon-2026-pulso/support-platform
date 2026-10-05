/**
 * Core public API of the conversation feature: what the always-loaded app
 * shell and the core of other features may import without pulling in any
 * screen (ARCHITECTURE.md §3, "Two public files"). The realtime handlers of the
 * open case, its query keys, the shared language / queue labels and the types.
 * No components and nothing that reaches one: src/test/architecture.test.ts
 * checks it.
 */
export { conversationKeys } from './api'
export { registerConversationRealtime } from './realtime'
export { LANGUAGE_NAMES, PREVIOUS_CASES_LIST, QUEUE_LABEL, formatWait, shortCaseId } from './model'
export type { ConversationMode, PreviousCasesSelection } from './model'
export type {
  AssignmentOut,
  Call,
  CaseCustomer,
  CaseDetail,
  CaseHistory,
  CaseHistoryItem,
  Language,
  Turn,
} from './types'
