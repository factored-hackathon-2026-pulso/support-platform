/**
 * Audit calls (docs/platform/api/slice-3-supervision.md §5.1): the event log,
 * one event, and the staff directory for the "Persona" filter. The only module
 * of the feature that talks to the API client; tests mock it with
 * `vi.mock('@/features/audit/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type { AuditEvent, AuditEventPage, AuditQuery, StaffMember } from './types'

/** Query keys (frozen by the contract §8.10). */
export const auditKeys = {
  all: ['audit'] as const,
  events: (query: AuditQuery) => ['audit', 'events', query] as const,
  event: (eventId: string) => ['audit', 'event', eventId] as const,
}

/** The staff directory behind the "Persona" filter (not audit data, so not under `auditKeys`). */
export const staffDirectoryKeys = { list: () => ['staff', 'directory', 'all'] as const }

/** Page size of the log ("Cargar más" asks for the next one). */
export const AUDIT_PAGE_SIZE = 50

/** GET /audit/events: newest first; `cursor` = `nextCursor` of the previous page. */
export async function fetchAuditEvents(
  query: AuditQuery,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<AuditEventPage> {
  return unwrap(
    api.GET('/api/v1/audit/events', {
      params: {
        query: { ...query, ...(cursor ? { cursor } : {}), limit: AUDIT_PAGE_SIZE },
      },
      signal,
    }),
  )
}

/** GET /audit/events/{eventId}: an event that is not in the loaded pages (`?evento=`). */
export async function fetchAuditEvent(eventId: string, signal?: AbortSignal): Promise<AuditEvent> {
  return unwrap(
    api.GET('/api/v1/audit/events/{eventId}', { params: { path: { eventId } }, signal }),
  )
}

/**
 * GET /staff?includeInactive=true, for the "Persona" filter: deactivated people
 * are still in the log (slice 4 §10.6).
 */
export async function fetchStaffDirectory(signal?: AbortSignal): Promise<StaffMember[]> {
  const response = await unwrap(
    api.GET('/api/v1/staff', { params: { query: { includeInactive: true } }, signal }),
  )
  return response.items
}
