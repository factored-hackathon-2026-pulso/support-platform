/**
 * API types of the customer simulator (docs/platform/api/slice-2-case-lifecycle.md §6):
 * aliases of the schemas generated from `backend/openapi.json` (`pnpm gen:api`),
 * plus the UI-only chat cache.
 */
import type { Schemas } from '@/lib/api'

export type Language = Schemas['Language']
export type CaseChannel = Schemas['CaseChannel']
export type CustomerLocale = Schemas['CustomerLocale']
export type CountryCode = Schemas['CountryCode']
export type CustomerConversationStatus = Schemas['CustomerConversationStatus']
export type CustomerTurnAuthor = Schemas['CustomerTurnAuthor']

/** `suggestions` are opener chips in the customer's own voice and locale. */
export type DemoCustomer = Schemas['DemoCustomer']
export type DemoConversation = Schemas['DemoConversation']
export type DemoCustomerList = Schemas['DemoCustomerList']
export type CreateCustomerSessionRequest = Schemas['CreateCustomerSessionRequest']
export type CustomerSelf = Schemas['CustomerSelf']
export type CustomerSessionResponse = Schemas['CustomerSessionResponse']
/**
 * `agentName` is the assignee's first name while `with_agent`; on a closed
 * conversation, who attended it. `previousCaseId` links a conversation opened
 * after a close.
 */
export type CustomerConversation = Schemas['CustomerConversation']
/** `sequence` is the case sequence: customer-visible turns may skip numbers. */
export type CustomerTurn = Schemas['CustomerTurn']
/** The current conversation, its visible turns and how many closed ones came before. */
export type CustomerConversationResponse = Schemas['CustomerConversationResponse']
/** The customer's closed conversations other than the current one, newest first (≤ 20). */
export type CustomerConversationList = Schemas['CustomerConversationList']
export type CustomerConversationSummary = Schemas['CustomerConversationSummary']
/** One own conversation with its latest `everyone` turns, ascending. */
export type CustomerConversationDetail = Schemas['CustomerConversationDetail']
export type PostCustomerTurnRequest = Schemas['PostCustomerTurnRequest']
/** The customer's own rating of a closed conversation (slice 7): score 1–4, comment. */
export type CaseRating = Schemas['CaseRating']
export type RateConversationRequest = Schemas['RateConversationRequest']
export type PostCustomerTurnResponse = Schemas['PostCustomerTurnResponse']
/** Slice 12: the customer's side of a simulated call (never the reason nor staff ids). */
export type CustomerCall = Schemas['CustomerCall']
export type CustomerCallState = Schemas['CustomerCallState']
export type CustomerCallResponse = Schemas['CustomerCallResponse']
export type CustomerCallLineResponse = Schemas['CustomerCallLineResponse']
/** Slice 12: an email the customer sent or got (`in` = from the customer). */
export type CustomerEmail = Schemas['CustomerEmail']
export type SendEmailRequest = Schemas['SendEmailRequest']
export type SendEmailResponse = Schemas['SendEmailResponse']

/** A message the customer sent that the server has not confirmed yet. */
export interface PendingCustomerMessage {
  clientMessageId: string
  text: string
  createdAt: string
  status: 'sending' | 'failed'
}

/** A conversation that ended while the simulator was open, kept in view with its turns. */
export interface EndedConversation {
  conversation: CustomerConversation
  turns: CustomerTurn[]
}

/**
 * Chat cache of the signed-in simulator customer
 * (`customerChatKeys.conversation(customerId)`): the current conversation, its
 * customer-visible turns in sequence order, messages still being sent, how many
 * closed conversations came before (server count) and the ones that ended here
 * (shown as past blocks right above the current one, oldest first).
 */
export interface CustomerChatCache {
  conversation: CustomerConversation | null
  turns: CustomerTurn[]
  pending: PendingCustomerMessage[]
  pastConversationCount: number
  ended: EndedConversation[]
}
