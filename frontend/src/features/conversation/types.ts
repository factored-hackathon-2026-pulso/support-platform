/**
 * API types of the conversation feature (docs/platform/api/slice-1-cases.md §3.2):
 * aliases of the schemas generated from `backend/openapi.json` (`pnpm gen:api`),
 * plus the UI-only transcript cache.
 */
import type { CaseChannel, CaseSummary } from '@/features/cases'
import type { Schemas } from '@/lib/api'

export type { CaseChannel, CaseSummary }

export type Language = Schemas['Language']
export type TurnKind = Schemas['TurnKind']
export type TurnAudience = Schemas['TurnAudience']
export type TurnAuthorRole = Schemas['TurnAuthorRole']
export type Tier = Schemas['Tier']
export type RoutingOutcome = Schemas['RoutingOutcome']
export type RouteStopKind = Schemas['RouteStopKind']
export type AssignmentReason = Schemas['AssignmentReason']
export type ChannelSessionKind = Schemas['ChannelSessionKind']
export type ContactReason = Schemas['ContactReason']
export type ResolutionCode = Schemas['ResolutionCode']
export type FollowUp = Schemas['FollowUp']
export type CustomerSegment = Schemas['CustomerSegment']
export type CountryCode = Schemas['CountryCode']
export type CustomerLocale = Schemas['CustomerLocale']

export type CustomerProfile = Schemas['CustomerProfile']
export type ChannelIdentity = Schemas['ChannelIdentity']
export type AssignmentOut = Schemas['AssignmentOut']
export type RouteStop = Schemas['RouteStop']
export type RoutingSummary = Schemas['RoutingSummary']
export type CaseClosure = Schemas['CaseClosure']
export type CaseCapabilities = Schemas['CaseCapabilities']
export type ReplyBlockedReason = Schemas['ReplyBlockedReason']
export type CaseDetail = Schemas['CaseDetail']
/** `sequence` is 1-based and gap-free per case (includes staff-only turns). */
export type Turn = Schemas['Turn']
export type TurnPage = Schemas['TurnPage']
export type PostAnalystTurnRequest = Schemas['PostAnalystTurnRequest']
export type PostTurnResponse = Schemas['PostTurnResponse']
export type MarkReadRequest = Schemas['MarkReadRequest']
export type CloseCaseRequest = Schemas['CloseCaseRequest']

/** A message the analyst sent that the server has not confirmed yet (optimistic UI). */
export interface PendingMessage {
  clientMessageId: string
  text: string
  /** ISO time the analyst pressed "Enviar". */
  createdAt: string
  status: 'sending' | 'failed'
  /** Spanish copy for the failure (from `describeSendFailure`). */
  error: string | null
  /** False when re-sending cannot help (closed case, channel not supported). */
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
