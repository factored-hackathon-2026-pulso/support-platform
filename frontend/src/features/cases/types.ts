/**
 * API types of the cases feature (docs/platform/api/slice-2-case-lifecycle.md §2.1, §5.2):
 * aliases of the schemas generated from `backend/openapi.json` (`pnpm gen:api`).
 */
import type { Schemas } from '@/lib/api'

export type CaseChannel = Schemas['CaseChannel']
export type CasePriority = Schemas['CasePriority']
/** What the case is about (slice 18): a dataset complaint subcategory, or none. */
export type CaseType = Schemas['CaseType']
export type CaseStatus = Schemas['CaseStatus']
/** Team-generated close reasons (contract §4.4). */
export type CloseReason = Schemas['CloseReason']
/** Canvas bucket, derived by the server (never re-derived here). */
export type InboxStatus = Schemas['InboxStatus']
export type CaseLanguage = Schemas['Language']
export type TurnAuthorRole = Schemas['TurnAuthorRole']
export type AvailabilityStatus = Schemas['AvailabilityStatus']
export type CountryCode = Schemas['CountryCode']

export type CustomerRef = Schemas['CustomerRef']
export type CaseSummary = Schemas['CaseSummary']
/** The customer's rating of a closed case (slice 7): score 1–4, optional comment. */
export type CaseRating = Schemas['CaseRating']
export type InboxCounts = Schemas['InboxCounts']
export type InboxResponse = Schemas['InboxResponse']
export type Availability = Schemas['Availability']
export type UpdateAvailabilityRequest = Schemas['UpdateAvailabilityRequest']
/** An escalation to supervision (slice 9): staff only, never the customer. */
export type Escalation = Schemas['Escalation']
export type EscalationState = Schemas['EscalationState']
