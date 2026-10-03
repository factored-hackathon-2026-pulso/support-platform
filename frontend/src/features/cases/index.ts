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
