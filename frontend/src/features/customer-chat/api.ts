/**
 * Customer simulator calls (docs/platform/api/slice-2-case-lifecycle.md §6). The simulator
 * has its own API client bound to the **customer** token store, so the staff
 * session is never sent nor cleared from here. Tests mock this module with
 * `vi.mock('@/features/customer-chat/api')`.
 */
import { createApiClient, unwrap } from '@/lib/api'
import { customerSessionToken } from '@/lib/session-token'
import type {
  CreateCustomerSessionRequest,
  CustomerConversationDetail,
  CustomerConversationList,
  CustomerConversationResponse,
  CustomerSessionResponse,
  DemoCustomerList,
  PostCustomerTurnRequest,
  PostCustomerTurnResponse,
  RateConversationRequest,
  CustomerConversation,
} from './types'

/** Query keys (frozen by the contract §9.6). */
export const customerChatKeys = {
  all: ['customer-chat'] as const,
  demoCustomers: () => ['customer-chat', 'demo-customers'] as const,
  conversation: (customerId: string) => ['customer-chat', customerId, 'conversation'] as const,
  pastConversations: (customerId: string) => ['customer-chat', customerId, 'past'] as const,
  pastConversation: (customerId: string, caseId: string) =>
    ['customer-chat', customerId, 'past', caseId] as const,
}

export const customerChatMutationKeys = {
  start: ['customer-chat', 'start'] as const,
  send: (customerId: string) => ['customer-chat', customerId, 'send'] as const,
  rate: (customerId: string) => ['customer-chat', customerId, 'rate'] as const,
}

/** Bearer = customer token; a 401 for it clears it (back to the picker). */
export const customerApi = createApiClient({ tokenStore: customerSessionToken })

/** GET /customer/demo-customers (no auth): simulator customers first, then the other seeded ones. */
export async function listDemoCustomers(signal?: AbortSignal): Promise<DemoCustomerList> {
  return unwrap(customerApi.GET('/api/v1/customer/demo-customers', { signal }))
}

/** POST /customer/sessions: a customer token (`aud = cc-customer`) for the picked customer. */
export async function createCustomerSession(
  body: CreateCustomerSessionRequest,
): Promise<CustomerSessionResponse> {
  return unwrap(customerApi.POST('/api/v1/customer/sessions', { body }))
}

/**
 * GET /customer/conversation: the open case (or the last closed one), its
 * visible turns and `pastConversationCount`.
 */
export async function fetchCustomerConversation(
  signal?: AbortSignal,
): Promise<CustomerConversationResponse> {
  return unwrap(customerApi.GET('/api/v1/customer/conversation', { signal }))
}

/** POST /customer/conversation/turns: opens a case when none is open (also after a close), else appends. */
export async function postCustomerTurn(
  body: PostCustomerTurnRequest,
): Promise<PostCustomerTurnResponse> {
  return unwrap(
    customerApi.POST('/api/v1/customer/conversation/turns', {
      params: { header: { 'Idempotency-Key': body.clientMessageId } },
      body,
    }),
  )
}

/** GET /customer/conversations: closed conversations other than the current one, newest first. */
export async function listPastConversations(
  signal?: AbortSignal,
): Promise<CustomerConversationList> {
  return unwrap(customerApi.GET('/api/v1/customer/conversations', { signal }))
}

/** GET /customer/conversations/{caseId}: one own conversation, read-only (404 if not theirs). */
export async function fetchPastConversation(
  caseId: string,
  signal?: AbortSignal,
): Promise<CustomerConversationDetail> {
  return unwrap(
    customerApi.GET('/api/v1/customer/conversations/{caseId}', {
      params: { path: { caseId } },
      signal,
    }),
  )
}

/**
 * POST /customer/conversations/{caseId}/rating (slice 7): rate a closed conversation once
 * (1–4, optional comment). The same `Idempotency-Key` + the same answer replays (200).
 */
export async function rateConversation(
  caseId: string,
  body: RateConversationRequest,
  idempotencyKey: string,
): Promise<CustomerConversation> {
  return unwrap(
    customerApi.POST('/api/v1/customer/conversations/{caseId}/rating', {
      params: { path: { caseId }, header: { 'Idempotency-Key': idempotencyKey } },
      body,
    }),
  )
}
