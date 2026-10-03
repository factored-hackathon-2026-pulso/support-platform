/**
 * API types of the audit feature (docs/platform/api/slice-3-supervision.md §5.2):
 * aliases of the schemas generated from `backend/openapi.json` (`pnpm gen:api`),
 * plus the query the list sends.
 */
import type { Schemas } from '@/lib/api'

export type AuditEvent = Schemas['AuditEvent']
export type AuditEventPage = Schemas['AuditEventPage']
export type AuditFamily = Schemas['AuditFamily']
export type AuditActorKind = Schemas['AuditActorKind']
export type AuditActor = Schemas['AuditActor']
export type AuditCaseRef = Schemas['AuditCaseRef']
export type ActorRole = Schemas['ActorRole']
/** The "Persona" filter lists the active staff (GET /staff). */
export type StaffMember = Schemas['StaffOut']

/**
 * Filters of GET /audit/events (§5.1), as the screen sends them: dates already
 * converted to UTC instants, empty values left out. Also the query key.
 */
export interface AuditQuery {
  actorKind?: AuditActorKind
  actorId?: string
  caseId?: string
  family?: AuditFamily
  changesOnly?: boolean
  /** Inclusive, on `occurredAt`. */
  from?: string
  /** Exclusive. */
  to?: string
  q?: string
}
