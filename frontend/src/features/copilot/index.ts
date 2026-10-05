/**
 * Public API of the copilot feature (slice 20, the analyst's support panel): the "Copiloto" and
 * "Herramientas" tabs, the draft above the composer, the escalation recommendation and the hooks
 * the Workspace uses to decide which tabs exist (docs/platform/api/slice-20-support-panel.md).
 * Everything in `./core` is re-exported here; the app shell imports `core` only.
 */
export * from './core'
export { CopilotPanel } from './components/CopilotPanel'
export type { CopilotPanelProps } from './components/CopilotPanel'
export { ToolsPanel } from './components/ToolsPanel'
export type { ToolsPanelProps } from './components/ToolsPanel'
export { CopilotDraft } from './components/CopilotDraft'
export type { CopilotDraftProps, DraftTakeMode, TakenDraft } from './components/CopilotDraft'
export { EscalationSuggestion } from './components/EscalationSuggestion'
export type {
  EscalationPrefill,
  EscalationSuggestionProps,
} from './components/EscalationSuggestion'
export { useCopilotAccess, useCopilotThread } from './hooks/use-copilot'
export type { CopilotCase } from './hooks/use-copilot'
export { useLatestSuggestion } from './hooks/use-suggestions'
export { StageStrip } from './components/StageStrip'
export type { StageStripProps } from './components/StageStrip'
export { useAiStages } from './hooks/use-stages'
