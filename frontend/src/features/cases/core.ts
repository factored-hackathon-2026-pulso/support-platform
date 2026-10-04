/**
 * Core public API of the cases feature: what the always-loaded app shell and
 * the core of other features may import without pulling in any screen
 * (ARCHITECTURE.md §3, "Two public files"). Query keys, the realtime handlers,
 * the case readers, the shared case labels and the types. No components and
 * nothing that reaches one: src/test/architecture.test.ts checks it.
 */
export { availabilityKeys, caseKeys } from './api'
export { useAvailabilityPresence, useToReplyCount } from './hooks/use-analyst-shell'
export { applyCaseSummaryToInboxes, readCaseSummary, registerCasesRealtime } from './realtime'
export {
  CLOSE_REASONS,
  INBOX_FILTERS,
  caseCardFacts,
  channelFact,
  channelLabel,
  channelPhrase,
  closeReasonLabel,
  closeReasonOption,
  compareByUrgency,
  countryName,
  filterChipLabel,
  formatSla,
  inboxStatusFromSlug,
  inboxStatusMeta,
  isNewerCase,
  RATING_SCALE,
  priorityFact,
  priorityLabel,
  ratedByCustomerLabel,
  ratedShortLabel,
  ratingFact,
  ratingLabel,
  ratingOption,
  slaFact,
  slugFromInboxStatus,
  sortByUrgency,
  urgencyGroup,
} from './model'
export type {
  CloseReasonOption,
  InboxFilter,
  InboxStatusMeta,
  RatingOption,
  RatingScore,
  SlaLevel,
  SlaDisplay,
  ToastCopy,
} from './model'
export type {
  Availability,
  AvailabilityStatus,
  CaseChannel,
  CasePriority,
  CaseRating,
  CaseStatus,
  CaseSummary,
  CloseReason,
  InboxCounts,
  InboxResponse,
  InboxStatus,
} from './types'
