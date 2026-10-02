/**
 * Customer simulator calls (docs/platform/api/slice-1-cases.md §4). The simulator
 * has its own API client bound to the **customer** token store, so the staff
 * session is never sent nor cleared from here. Tests mock this module with
 * `vi.mock('@/features/customer-chat/api')`.
 */
import { createApiClient, unwrap } from '@/lib/api'
import { customerSessionToken } from '@/lib/session-token'
import type {
  CreateCustomerSessionRequest,
  CustomerConversationResponse,
  CustomerSessionResponse,
  DemoCustomerList,
  PostCustomerTurnRequest,
  PostCustomerTurnResponse,
} from './types'

/** Query keys (frozen by the contract §7.2). */
export const customerChatKeys = {
  all: ['customer-chat'] as const,
  demoCustomers: () => ['customer-chat', 'demo-customers'] as const,
  conversation: (customerId: string) => ['customer-chat', customerId, 'conversation'] as const,
}

export const customerChatMutationKeys = {
  start: ['customer-chat', 'start'] as const,
  send: (customerId: string) => ['customer-chat', customerId, 'send'] as const,
}

/** Bearer = customer token; a 401 for it clears it (back to the picker). */
export const customerApi = createApiClient({ tokenStore: customerSessionToken })

/** GET /customer/demo-customers (no auth): simulator customers, then those with an open chat. */
export async function listDemoCustomers(signal?: AbortSignal): Promise<DemoCustomerList> {
  return unwrap(customerApi.GET('/api/v1/customer/demo-customers', { signal }))
}

/** POST /customer/sessions: a customer token (`aud = cc-customer`) for the picked customer. */
export async function createCustomerSession(
  body: CreateCustomerSessionRequest,
): Promise<CustomerSessionResponse> {
  return unwrap(customerApi.POST('/api/v1/customer/sessions', { body }))
}

/** GET /customer/conversation: the open case (or the last closed one) and its visible turns. */
export async function fetchCustomerConversation(
  signal?: AbortSignal,
): Promise<CustomerConversationResponse> {
  return unwrap(customerApi.GET('/api/v1/customer/conversation', { signal }))
}

/** POST /customer/conversation/turns: opens a case when none is open, else appends. */
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
