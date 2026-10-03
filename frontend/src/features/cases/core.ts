/**
 * Core public API of the cases feature: what the always-loaded app shell and
 * the core of other features may import without pulling in any screen
 * (ARCHITECTURE.md §3, "Two public files"). Query keys, the realtime handlers,
 * the case readers, the shared case labels and the types. No components and
 * nothing that reaches one: src/test/architecture.test.ts checks it.
 */
export { availabilityKeys, caseKeys } from './api'
export { applyCaseSummaryToInboxes, readCaseSummary, registerCasesRealtime } from './realtime'
export {
  CLOSE_REASONS,
  INBOX_FILTERS,
  channelLabel,
  channelPhrase,
  closeReasonLabel,
  countryName,
  formatSla,
  inboxStatusFromSlug,
  inboxStatusMeta,
  isNewerCase,
  priorityLabel,
  slugFromInboxStatus,
} from './model'
export type { InboxFilter, InboxStatusMeta, SlaDisplay, ToastCopy } from './model'
export type {
  Availability,
  AvailabilityStatus,
  CaseChannel,
  CasePriority,
  CaseStatus,
  CaseSummary,
  CloseReason,
  InboxCounts,
  InboxResponse,
  InboxStatus,
} from './types'
