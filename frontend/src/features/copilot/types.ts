/**
 * API types of the copilot feature (slice 15: the Q&A thread; slice 15b: the suggestions),
 * aliases of the schemas generated from `backend/openapi.json`, plus the UI-only questions in
 * flight.
 */
import type { Schemas } from '@/lib/api'

export type CopilotThread = Schemas['CopilotThread']
export type CopilotMessage = Schemas['CopilotMessage']
export type CopilotExchange = Schemas['CopilotExchange']
export type CopilotSuggestion = Schemas['CopilotSuggestion']
export type LatestCopilotSuggestion = Schemas['LatestCopilotSuggestion']
export type SuggestionReply = Schemas['SuggestionReply']
export type SuggestionTool = Schemas['SuggestionTool']
export type SuggestionAction = Schemas['SuggestionAction']
export type SuggestionEscalation = Schemas['SuggestionEscalation']
export type SuggestionItem = CopilotSuggestion['suggestions'][number]
export type SuggestionStatus = CopilotSuggestion['status']
/** What she can post about the draft: `used` / `edited` come from the reply itself. */
export type SuggestionFeedback = Schemas['SuggestionFeedbackRequest']['decision']

/**
 * A question she asked in this session that has no confirmed answer yet: on its way, or failed
 * (it is retried with the **same** `clientMessageId`, so the copilot is never asked twice).
 */
export interface CopilotAsk {
  clientMessageId: string
  text: string
  /** ISO time she pressed "Preguntar". */
  createdAt: string
  status: 'asking' | 'failed'
  /** Spanish copy for the failure (`describeAskFailure`). */
  error: string | null
  /** False when asking again cannot help (closed case, customer not linked). */
  retryable: boolean
}
