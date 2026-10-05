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
  CustomerCallLineResponse,
  CustomerCallResponse,
  CustomerCallState,
  SendEmailRequest,
  SendEmailResponse,
  CustomerConversationDetail,
  CustomerConversationList,
  CustomerConversationResponse,
  CustomerSessionResponse,
  DemoCustomerList,
  PostCustomerTurnRequest,
  PostCustomerTurnResponse,
  RateConversationRequest,
  CustomerConversation,
  CustomerPlatformSettings,
} from './types'

/** Query keys (frozen by the contract §9.6). */
export const customerChatKeys = {
  all: ['customer-chat'] as const,
  demoCustomers: () => ['customer-chat', 'demo-customers'] as const,
  conversation: (customerId: string) => ['customer-chat', customerId, 'conversation'] as const,
  pastConversations: (customerId: string) => ['customer-chat', customerId, 'past'] as const,
  pastConversation: (customerId: string, caseId: string) =>
    ['customer-chat', customerId, 'past', caseId] as const,
  /** Slice 12: the current (or latest) call of the signed-in customer. */
  call: (customerId: string) => ['customer-chat', customerId, 'call'] as const,
  /** Slice 18: the platform settings as the simulator sees them (the AI switch). */
  platform: () => ['customer-chat', 'platform'] as const,
}

export const customerChatMutationKeys = {
  start: ['customer-chat', 'start'] as const,
  send: (customerId: string) => ['customer-chat', customerId, 'send'] as const,
  rate: (customerId: string) => ['customer-chat', customerId, 'rate'] as const,
  call: (customerId: string) => ['customer-chat', customerId, 'call'] as const,
  email: (customerId: string) => ['customer-chat', customerId, 'email'] as const,
}

/** Bearer = customer token; a 401 for it clears it (back to the picker). */
export const customerApi = createApiClient({ tokenStore: customerSessionToken })

/** GET /customer/platform (slice 18): whether the AI functions are on (customer token). */
export async function fetchCustomerPlatform(
  signal?: AbortSignal,
): Promise<CustomerPlatformSettings> {
  return unwrap(customerApi.GET('/api/v1/customer/platform', { signal }))
}

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

// ── Slice 12: calls and emails (docs/platform/api/slice-12-channels.md §3.2) ──

/** GET /customer/call: the active call of the current conversation, else its latest one. */
export async function fetchCustomerCall(signal?: AbortSignal): Promise<CustomerCallState> {
  return unwrap(customerApi.GET('/api/v1/customer/call', { signal }))
}

/**
 * POST /customer/calls: the customer calls the bank. Joins the open case or opens one
 * (`phone_inbound`). `idempotencyKey`: a retry replays the same call.
 */
export async function startCustomerCall(idempotencyKey: string): Promise<CustomerCallResponse> {
  return unwrap(
    customerApi.POST('/api/v1/customer/calls', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
    }),
  )
}

export type CustomerCallCommand = 'answer' | 'reject' | 'hangup'

/** "Contestar" / "Rechazar" a call of the bank; "Colgar" any active call. */
export async function commandCustomerCall(
  callId: string,
  command: CustomerCallCommand,
): Promise<CustomerCallResponse> {
  const params = { path: { callId } }
  switch (command) {
    case 'answer':
      return unwrap(customerApi.POST('/api/v1/customer/calls/{callId}/answer', { params }))
    case 'reject':
      return unwrap(customerApi.POST('/api/v1/customer/calls/{callId}/reject', { params }))
    case 'hangup':
      return unwrap(customerApi.POST('/api/v1/customer/calls/{callId}/hangup', { params }))
  }
}

/** POST /customer/calls/{callId}/transcript: what the customer says (only `in_call`). */
export async function postCustomerCallLine(
  callId: string,
  body: { text: string; clientMessageId: string },
): Promise<CustomerCallLineResponse> {
  return unwrap(
    customerApi.POST('/api/v1/customer/calls/{callId}/transcript', {
      params: { path: { callId }, header: { 'Idempotency-Key': body.clientMessageId } },
      body,
    }),
  )
}

/** POST /customer/emails: joins the open case or opens one (`email`). */
export async function sendCustomerEmail(body: SendEmailRequest): Promise<SendEmailResponse> {
  return unwrap(
    customerApi.POST('/api/v1/customer/emails', {
      params: { header: { 'Idempotency-Key': body.clientMessageId } },
      body,
    }),
  )
}
