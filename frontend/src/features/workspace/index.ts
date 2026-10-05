/**
 * Public API of the workspace feature: the analyst Workspace screen and its URL
 * state (docs/platform/api/slice-2-case-lifecycle.md §9.7).
 */
export { WorkspaceScreen } from './components/WorkspaceScreen'
export type { WorkspaceScreenProps } from './components/WorkspaceScreen'
export { parseWorkspaceSearch, toWorkspaceSearch } from './url'
export type { WorkspacePanel, WorkspaceStateChangeOptions, WorkspaceUrlState } from './url'
