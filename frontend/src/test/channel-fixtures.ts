import type { Call } from '@/features/conversation'
import type { CustomerCall } from '@/features/customer-chat'
import { CASE_ID, CUSTOMER_ID, makeTurn } from './conversation-fixtures'
import { analystStaff } from './fixtures'

/**
 * Invented calls and emails for tests (slice 12, "Datos de ejemplo"): a call of Marcela's case
 * 101 answered by the signed-in analyst, the lines both ways and an email thread.
 */

export const CALL_ID = 'CALL-00000000000000000000000101'
const STARTED = '2026-03-05T16:00:00Z'
const ANSWERED = '2026-03-05T16:00:20Z'

export function makeCall(overrides: Partial<Call> = {}): Call {
  return {
    id: CALL_ID,
    caseId: CASE_ID,
    version: 1,
    direction: 'inbound',
    state: 'in_call',
    reason: null,
    analystId: analystStaff.id,
    analystName: 'Daniela Ríos',
    startedAt: STARTED,
    answeredAt: ANSWERED,
    endedAt: null,
    endReason: null,
    endedByRole: null,
    muted: false,
    holds: [],
    holdSeconds: 0,
    durationSeconds: null,
    ...overrides,
  }
}

export function makeCustomerCall(overrides: Partial<CustomerCall> = {}): CustomerCall {
  return {
    id: CALL_ID,
    caseId: CASE_ID,
    direction: 'inbound',
    state: 'in_call',
    agentName: 'Daniela',
    startedAt: STARTED,
    answeredAt: ANSWERED,
    endedAt: null,
    endReason: null,
    onHold: false,
    durationSeconds: null,
    ...overrides,
  }
}

/** A line of the call `seconds` after the answer. */
export function makeLine(
  sequence: number,
  text: string,
  who: 'customer' | 'analyst' | 'system',
  seconds: number,
) {
  return makeTurn({
    sequence,
    kind: 'transcript',
    authorRole: who,
    authorId: who === 'customer' ? CUSTOMER_ID : who === 'analyst' ? analystStaff.id : null,
    authorName:
      who === 'customer' ? 'Marcela Quintana Pardo' : who === 'analyst' ? 'Daniela Ríos' : null,
    text,
    createdAt: new Date(new Date(ANSWERED).getTime() + seconds * 1000).toISOString(),
  })
}

/** An email of the case's thread. */
export function makeEmail(
  sequence: number,
  body: string,
  from: 'customer' | 'analyst',
  subject = 'Cobro duplicado en mi tarjeta',
) {
  return makeTurn({
    sequence,
    kind: 'email',
    authorRole: from,
    authorId: from === 'customer' ? CUSTOMER_ID : analystStaff.id,
    authorName: from === 'customer' ? 'Marcela Quintana Pardo' : 'Daniela Ríos',
    text: body,
    subject,
  })
}
