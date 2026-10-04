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
  | 'inbox.counts'
  | 'availability.updated'
  | 'conversation.updated'
  // Slice 3 (supervision, slice-3-supervision.md §7.2)
  | 'case.unassigned'
  | 'queue.updated'
  | 'queue.case_queued'
  | 'team.updated'
  // Slice 4 (administration, slice-4-administration.md §9.2)
  | 'directory.updated'
  | 'me.updated'
  // Slice 9 (escalations, slice-9-supervision-v2.md): on `case:`, `inbox:` and
  // `supervision:escalations`
  | 'escalation.updated'
  // Slice 10 (notification center, slice-10-notifications.md §4.4): on `staff:<id>` only
  | 'notification.created'
  | 'notifications.read'

export type RealtimeEventType = KnownRealtimeEventType | ControlEnvelopeType | (string & {})

export interface RealtimeEnvelope<TData = unknown, TType extends string = RealtimeEventType> {
  type: TType
  /** Event id (idempotency: the same id may arrive twice after a reconnect). */
  id: string
  /** ISO-8601 UTC. */
  occurredAt: string
  data: TData
}

/** Keys of the supervision topics (slice 3 §7.1; slice 9 adds `escalations`). */
export type SupervisionTopicKey = 'queues' | 'team' | 'escalations'

/**
 * `case:<caseId>`, `inbox:<staffId>` (staff tokens), `customer:<customerId>`
 * (only the customer token whose subject is that id), `supervision:queues` /
 * `supervision:team` (staff holding the supervisor role), `admin:directory`
 * (staff holding the admin role) and `staff:<staffId>` (only that person).
 */
export type RealtimeTopic =
  | `case:${string}`
  | `inbox:${string}`
  | `customer:${string}`
  | `supervision:${SupervisionTopicKey}`
  | 'admin:directory'
  | `staff:${string}`

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
  customer: (customerId: string): RealtimeTopic => `customer:${customerId}`,
  supervisionQueues: (): RealtimeTopic => 'supervision:queues',
  supervisionTeam: (): RealtimeTopic => 'supervision:team',
  supervisionEscalations: (): RealtimeTopic => 'supervision:escalations',
  adminDirectory: (): RealtimeTopic => 'admin:directory',
  staff: (staffId: string): RealtimeTopic => `staff:${staffId}`,
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

/**
 * `data.actor` of a domain envelope (`{ role, id }`, e.g. `{ role: 'supervisor',
 * id: 'STF-…' }`; `id` is null for the platform), or null when it is missing or
 * malformed.
 */
export function envelopeActor(
  envelope: RealtimeEnvelope,
): { role: string; id: string | null } | null {
  if (!isRecord(envelope.data)) return null
  const { actor } = envelope.data
  if (!isRecord(actor) || typeof actor.role !== 'string') return null
  return { role: actor.role, id: typeof actor.id === 'string' ? actor.id : null }
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
