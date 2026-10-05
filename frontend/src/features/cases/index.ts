/**
 * Public API of the cases feature: the Workspace "Casos" column, the inbox and
 * availability queries, their realtime handlers and the shared case labels
 * (docs/platform/api/slice-2-case-lifecycle.md §9.7). Imports no other feature.
 * Everything in `./core` is re-exported here; the app shell imports `core` only.
 */
export * from './core'
export { CaseListPanel } from './components/CaseListPanel'
export type { CaseListPanelProps } from './components/CaseListPanel'
export { useAvailability, useInbox, useUpdateAvailability } from './hooks'
export { CloseReasonIcon } from './components/CloseReasonIcon'
export { CLOSE_REASON_ICON, CLOSE_REASON_TILE } from './components/close-reason-styles'
export type { CloseReasonIconProps } from './components/CloseReasonIcon'
export { CaseTypeMenu } from './components/CaseTypeMenu'
export type { CaseTypeMenuProps } from './components/CaseTypeMenu'
export { PriorityMenu } from './components/PriorityMenu'
export type { PriorityMenuProps } from './components/PriorityMenu'
export { RatingBadge } from './components/RatingBadge'
export type { RatingBadgeProps } from './components/RatingBadge'
