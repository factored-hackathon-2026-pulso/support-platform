/**
 * Administration realtime (slice-4-administration.md §9.2, §10.9): the
 * `admin:directory` topic → the users and teams caches. Registered in
 * `app/realtime-handlers.ts`; keep this module light (keys + handlers only): it
 * is part of the main bundle.
 *
 * Sockets only signal: `directory.updated` carries the ids of what may have
 * changed, never rows, so every handler invalidates (refetch) and is safe to
 * repeat.
 */
import type { QueryClient } from '@tanstack/react-query'
import { envelopePayload, type RealtimeEnvelope, type RealtimeRegistration } from '@/lib/realtime'
import { adminKeys } from './api'

export interface DirectoryUpdate {
  staffIds: string[]
  teamIds: string[]
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/** `{ staffIds, teamIds }` of `directory.updated` (missing lists read as empty). */
export function readDirectoryUpdate(envelope: RealtimeEnvelope): DirectoryUpdate {
  const payload = envelopePayload(envelope)
  return { staffIds: stringList(payload?.staffIds), teamIds: stringList(payload?.teamIds) }
}

/**
 * `directory.updated`: every user list, the named people, every team list and
 * the named teams. When people changed, every team detail too: a membership
 * may have moved between teams the payload does not name.
 */
function invalidateDirectory(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const { staffIds, teamIds } = readDirectoryUpdate(envelope)
  void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
  for (const staffId of staffIds) {
    void queryClient.invalidateQueries({ queryKey: adminKeys.user(staffId), exact: true })
  }
  void queryClient.invalidateQueries({ queryKey: adminKeys.teams() })
  if (staffIds.length > 0) {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'team'] })
    return
  }
  for (const teamId of teamIds) {
    void queryClient.invalidateQueries({ queryKey: adminKeys.team(teamId), exact: true })
  }
}

export const registerAdminRealtime: RealtimeRegistration = (registry) => {
  registry.register('directory.updated', invalidateDirectory)
}
