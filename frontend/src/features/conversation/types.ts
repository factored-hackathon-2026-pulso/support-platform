/**
 * API types of the conversation feature (docs/platform/api/slice-2-case-lifecycle.md §5.2):
 * aliases of the schemas generated from `backend/openapi.json` (`pnpm gen:api`),
 * plus the UI-only transcript cache.
 */
import type {
  CaseChannel,
  CasePriority,
  CaseSummary,
  CaseType,
  CloseReason,
} from '@/features/cases/core'
import type { Schemas } from '@/lib/api'

export type { CaseChannel, CasePriority, CaseSummary, CaseType, CloseReason }

export type Language = Schemas['Language']
export type TurnKind = Schemas['TurnKind']
export type TurnAudience = Schemas['TurnAudience']
export type TurnAuthorRole = Schemas['TurnAuthorRole']
export type AssignmentReason = Schemas['AssignmentReason']
export type CountryCode = Schemas['CountryCode']
export type CustomerLocale = Schemas['CustomerLocale']

/** Who the customer is (no customer-file data): name, locale, language, place. */
export type CaseCustomer = Schemas['CaseCustomer']
/** "Cómo llegó a ti": who got the case, why, and the queue wait if any. */
export type AssignmentOut = Schemas['AssignmentOut']
export type CaseClosure = Schemas['CaseClosure']
export type CaseCapabilities = Schemas['CaseCapabilities']
export type ReplyBlockedReason = Schemas['ReplyBlockedReason']
export type CaseDetail = Schemas['CaseDetail']
/** The customer's other cases ("Casos anteriores"), newest first, at most 20. */
export type CaseHistory = Schemas['CaseHistory']
export type CaseHistoryItem = Schemas['CaseHistoryItem']
/** `sequence` is 1-based and gap-free per case (includes staff-only turns). */
export type Turn = Schemas['Turn']
export type TurnPage = Schemas['TurnPage']
export type PostAnalystTurnRequest = Schemas['PostAnalystTurnRequest']
export type PostTurnResponse = Schemas['PostTurnResponse']
export type MarkReadRequest = Schemas['MarkReadRequest']
export type CloseCaseRequest = Schemas['CloseCaseRequest']
/** Slice 8: PUT /cases/{caseId}/priority. */
export type ChangePriorityRequest = Schemas['ChangePriorityRequest']
export type CasePriorityResult = Schemas['CasePriorityResult']
/** Slice 18: PUT /cases/{caseId}/type. */
export type ChangeCaseTypeRequest = Schemas['ChangeCaseTypeRequest']
export type CaseTypeResult = Schemas['CaseTypeResult']
/** Slice 9: escalations to supervision (staff only). */
export type Escalation = Schemas['Escalation']
export type EscalationResult = Schemas['EscalationResult']
/** Slice 12: simulated calls (`CALL-…`) and email replies. */
export type Call = Schemas['Call']
export type CallList = Schemas['CallList']
export type CallResponse = Schemas['CallResponse']
export type CallState = Schemas['CallState']
export type CallDirection = Schemas['CallDirection']
export type CallEndReason = Schemas['CallEndReason']
export type EmailMessage = Schemas['EmailMessage']
export type EmailReplyRequest = Schemas['EmailReplyRequest']
export type EmailReplyResponse = Schemas['EmailReplyResponse']

/** A message the analyst sent that the server has not confirmed yet (optimistic UI). */
export interface PendingMessage {
  clientMessageId: string
  text: string
  /** ISO time the analyst pressed "Enviar". */
  createdAt: string
  status: 'sending' | 'failed'
  /** Spanish copy for the failure (from `describeSendFailure`). */
  error: string | null
  /** False when re-sending cannot help (closed case, not the assignee). */
  retryable: boolean
}

/**
 * Turns cache of one case (`conversationKeys.turns(caseId)`): confirmed turns in
 * ascending sequence, the cursor to load older ones, and the analyst's pending
 * messages. Realtime, sends and reloads all merge into it (model.ts).
 */
export interface TranscriptCache {
  turns: Turn[]
  olderCursor: string | null
  /**
   * Gap-free high-water mark: every turn from the first loaded page up to this
   * sequence is held. Catch-ups ask for `afterSequence=contiguousSequence` and gap
   * checks compare against it, so a turn merged past a hole (e.g. the analyst's
   * own reply confirmed by REST while the socket was down) cannot hide the hole.
   */
  contiguousSequence: number
  pending: PendingMessage[]
}
