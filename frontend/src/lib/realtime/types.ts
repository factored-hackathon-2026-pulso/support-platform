/**
 * Realtime wire format (docs/platform/ENGINEERING_BRIEF.md §4.4,
 * backend `cc_platform/api/routers/realtime.py`).
 *
 * The server pushes envelopes `{ type, id, occurredAt, data }` derived from
 * domain events; the client subscribes to topics. Payload types stay `unknown`
 * here on purpose: each feature narrows the `data` of the event types it
 * handles (see `handlers.ts`), so this module never needs to know them all.
 */

/** Event types the platform emits today. New types are accepted as plain strings. */
export type KnownRealtimeEventType =
  | 'turn.created'
  | 'case.updated'
  | 'case.assigned'
  | 'identity_check.updated'
  | 'tool_call.completed'
  | 'approval.updated'
  | 'copilot.message'
  | 'inbox.counts'
  | 'availability.updated'
  | 'conversation.updated'

export type RealtimeEventType = KnownRealtimeEventType | ControlEnvelopeType | (string & {})

export interface RealtimeEnvelope<TData = unknown, TType extends string = RealtimeEventType> {
  type: TType
  /** Event id (idempotency: the same id may arrive twice after a reconnect). */
  id: string
  /** ISO-8601 UTC. */
  occurredAt: string
  data: TData
}

/**
 * `case:<caseId>`, `inbox:<staffId>`, `approvals` (staff tokens) and
 * `customer:<customerId>` (only the customer token whose subject is that id).
 */
export type RealtimeTopic =
  `case:${string}` | `inbox:${string}` | `customer:${string}` | 'approvals'

/** Messages the client sends (one topic per message, backend `api/routers/realtime.py`). */
export type ClientMessage =
  | { action: 'subscribe'; topic: RealtimeTopic }
  | { action: 'unsubscribe'; topic: RealtimeTopic }
  | { action: 'ping' }

/**
 * Control envelopes the server sends besides domain events: `welcome` on connect,
 * `subscribed` / `unsubscribed` acks, `pong`, and `error` (`data.code`, e.g. forbidden topic).
 */
export const CONTROL_ENVELOPE_TYPES = [
  'welcome',
  'subscribed',
  'unsubscribed',
  'pong',
  'error',
] as const
export type ControlEnvelopeType = (typeof CONTROL_ENVELOPE_TYPES)[number]

export function isControlEnvelope(envelope: RealtimeEnvelope): boolean {
  return (CONTROL_ENVELOPE_TYPES as readonly string[]).includes(envelope.type)
}

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export const topics = {
  case: (caseId: string): RealtimeTopic => `case:${caseId}`,
  inbox: (staffId: string): RealtimeTopic => `inbox:${staffId}`,
  approvals: (): RealtimeTopic => 'approvals',
  customer: (customerId: string): RealtimeTopic => `customer:${customerId}`,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `data.payload` of a domain envelope (`data = { entity, entityId, caseId, actor,
 * payload }`, ARCHITECTURE.md §7), or null when the envelope does not have that
 * shape. Features narrow the payload of the event types they handle.
 */
export function envelopePayload(envelope: RealtimeEnvelope): Record<string, unknown> | null {
  if (!isRecord(envelope.data)) return null
  const { payload } = envelope.data
  return isRecord(payload) ? payload : null
}

/** `data.caseId` of a domain envelope, or null (not about a case, or malformed). */
export function envelopeCaseId(envelope: RealtimeEnvelope): string | null {
  if (!isRecord(envelope.data)) return null
  const { caseId } = envelope.data
  return typeof caseId === 'string' ? caseId : null
}

/** Validates an incoming frame. Anything else (pings, acks, garbage) is ignored. */
export function parseEnvelope(raw: unknown): RealtimeEnvelope | null {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!isRecord(value)) return null
  const { type, id, occurredAt } = value
  if (typeof type !== 'string' || typeof id !== 'string' || typeof occurredAt !== 'string')
    return null
  if (!('data' in value)) return null
  return { type, id, occurredAt, data: value.data }
}
