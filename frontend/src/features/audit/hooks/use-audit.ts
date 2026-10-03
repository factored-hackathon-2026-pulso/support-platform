import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import {
  auditKeys,
  fetchAuditEvent,
  fetchAuditEvents,
  fetchStaffDirectory,
  staffDirectoryKeys,
} from '../api'
import type { AuditEvent, AuditEventPage, AuditQuery, StaffMember } from '../types'

/**
 * GET /audit/events for a filter set, newest first, page after page ("Cargar
 * más" follows `nextCursor`). No realtime: the log is read on demand
 * ("Actualizar" refetches). `enabled: false` while the dates are invalid.
 */
export function useAuditEvents(
  query: AuditQuery,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<AuditEventPage, string | null>, ApiProblem> {
  return useInfiniteQuery<
    AuditEventPage,
    ApiProblem,
    InfiniteData<AuditEventPage, string | null>,
    ReturnType<typeof auditKeys.events>,
    string | null
  >({
    queryKey: auditKeys.events(query),
    queryFn: ({ pageParam, signal }) => fetchAuditEvents(query, pageParam, signal),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}

/** GET /audit/events/{id}: only for a `?evento=` that is not in the loaded pages. */
export function useAuditEvent(
  eventId: string | null,
  enabled: boolean,
): UseQueryResult<AuditEvent, ApiProblem> {
  return useQuery<AuditEvent, ApiProblem>({
    queryKey: auditKeys.event(eventId ?? ''),
    queryFn: ({ signal }) => fetchAuditEvent(eventId ?? '', signal),
    enabled: enabled && eventId !== null,
  })
}

/** GET /staff for the "Persona" filter (changes rarely: fresh for 5 minutes). */
export function useStaffDirectory(): UseQueryResult<StaffMember[], ApiProblem> {
  return useQuery<StaffMember[], ApiProblem>({
    queryKey: staffDirectoryKeys.list(),
    queryFn: ({ signal }) => fetchStaffDirectory(signal),
    staleTime: 5 * 60_000,
  })
}
