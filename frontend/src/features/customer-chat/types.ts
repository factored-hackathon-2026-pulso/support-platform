/**
 * API types of the customer simulator (docs/platform/api/slice-1-cases.md §4):
 * aliases of the schemas generated from `backend/openapi.json` (`pnpm gen:api`),
 * plus the UI-only chat cache.
 */
import type { Schemas } from '@/lib/api'

export type Language = Schemas['Language']
export type CaseChannel = Schemas['CaseChannel']
export type CustomerLocale = Schemas['CustomerLocale']
export type CountryCode = Schemas['CountryCode']
export type CustomerSegment = Schemas['CustomerSegment']
export type CustomerConversationStatus = Schemas['CustomerConversationStatus']
export type CustomerTurnAuthor = Schemas['CustomerTurnAuthor']

/** `suggestions` are opener chips in the customer's own voice and locale. */
export type DemoCustomer = Schemas['DemoCustomer']
export type DemoConversation = Schemas['DemoConversation']
export type DemoCustomerList = Schemas['DemoCustomerList']
export type CreateCustomerSessionRequest = Schemas['CreateCustomerSessionRequest']
export type CustomerSelf = Schemas['CustomerSelf']
export type CustomerSessionResponse = Schemas['CustomerSessionResponse']
/** `agentName` is the assignee's first name while `with_agent`. */
export type CustomerConversation = Schemas['CustomerConversation']
/** `sequence` is the case sequence: customer-visible turns may skip numbers. */
export type CustomerTurn = Schemas['CustomerTurn']
export type CustomerConversationResponse = Schemas['CustomerConversationResponse']
export type PostCustomerTurnRequest = Schemas['PostCustomerTurnRequest']
export type PostCustomerTurnResponse = Schemas['PostCustomerTurnResponse']

/** A message the customer sent that the server has not confirmed yet. */
export interface PendingCustomerMessage {
  clientMessageId: string
  text: string
  createdAt: string
  status: 'sending' | 'failed'
}

/**
 * Chat cache of the signed-in simulator customer
 * (`customerChatKeys.conversation(customerId)`): the current conversation, its
 * customer-visible turns in sequence order, and messages still being sent.
 */
export interface CustomerChatCache {
  conversation: CustomerConversation | null
  turns: CustomerTurn[]
  pending: PendingCustomerMessage[]
}
