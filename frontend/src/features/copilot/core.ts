/**
 * Core public API of the copilot feature (ARCHITECTURE.md §3, "Two public files"): what the
 * always-loaded app shell and other features' core may import without pulling in a screen. The
 * realtime registration, the query keys, the stage gating (slice 21: the stages per case type) and
 * the types. No components and
 * nothing that reaches one: src/test/architecture.test.ts checks it.
 */
export { copilotKeys } from './api'
export { registerCopilotRealtime } from './realtime'
export { copilotSurfaces, composerTextWithDraft } from './model'
export type { CopilotMode, CopilotSurfaces } from './model'
export { STAGE_TEXT, copilotModeOf, stageOfType, stageStrip } from './stages'
export type { AiStages, CaseTypeStage, StageStripView } from './stages'
export type {
  CopilotSuggestion,
  CopilotThread,
  LatestCopilotSuggestion,
  SuggestionItem,
} from './types'
