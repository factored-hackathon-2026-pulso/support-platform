/**
 * Public API of the cases feature: the Workspace "Casos" column, the inbox and
 * availability queries, their realtime handlers and the shared case labels
 * (docs/platform/api/slice-1-cases.md §7.1). Imports no other feature.
 */
export { CaseListPanel } from './components/CaseListPanel'
export type { CaseListPanelProps } from './components/CaseListPanel'
export { useAvailability, useInbox, useNow, useUpdateAvailability } from './hooks'
export { availabilityKeys, caseKeys } from './api'
export { applyCaseSummaryToInboxes, readCaseSummary, registerCasesRealtime } from './realtime'
export {
  INBOX_FILTERS,
  channelLabel,
  channelPhrase,
  countryName,
  formatSla,
  inboxStatusFromSlug,
  inboxStatusMeta,
  isNewerCase,
  priorityLabel,
  slugFromInboxStatus,
  topicLabel,
} from './model'
export type { InboxFilter, InboxStatusMeta, SlaDisplay } from './model'
export type {
  Availability,
  AvailabilityStatus,
  CaseChannel,
  CasePriority,
  CaseStatus,
  CaseSummary,
  CaseTopic,
  InboxCounts,
  InboxResponse,
  InboxStatus,
} from './types'
