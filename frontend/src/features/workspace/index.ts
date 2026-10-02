/**
 * Public API of the workspace feature: the analyst Workspace screen and its URL
 * state (docs/platform/api/slice-1-cases.md §7.1).
 */
export { WorkspaceScreen } from './components/WorkspaceScreen'
export type { WorkspaceScreenProps } from './components/WorkspaceScreen'
export { parseWorkspaceSearch, toWorkspaceSearch } from './model'
export type { SupportPanelTab, WorkspaceStateChangeOptions, WorkspaceUrlState } from './model'
