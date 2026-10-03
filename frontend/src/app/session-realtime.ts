/**
 * The signed-in person's own record, live (slice-4-administration.md §9.2,
 * §10.7): `me.updated` on `staff:<id>` carries her fresh `StaffOut` after an
 * admin changes her name, email, roles, languages or team (or renames her
 * team). The session cache takes it, so the rail, the role switcher and the
 * guards follow without signing in again. Keep this module light: it is part
 * of the main bundle.
 */
import type { QueryClient } from '@tanstack/react-query'
import { envelopePayload, type RealtimeEnvelope, type RealtimeRegistration } from '@/lib/realtime'
import { sessionKeys, type Staff } from './session'

/** The `StaffOut` payload of `me.updated`, or null when malformed. */
export function readStaff(envelope: RealtimeEnvelope): Staff | null {
  const payload = envelopePayload(envelope)
  if (
    !payload ||
    typeof payload.id !== 'string' ||
    typeof payload.name !== 'string' ||
    typeof payload.email !== 'string' ||
    !Array.isArray(payload.roles) ||
    !Array.isArray(payload.languages) ||
    typeof payload.team !== 'object' ||
    payload.team === null
  )
    return null
  return payload as unknown as Staff
}

/** `me.updated`: replaces the cached me, only when it is the same person. */
function applyMe(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const staff = readStaff(envelope)
  if (!staff) return
  const cached = queryClient.getQueryData<Staff>(sessionKeys.me())
  if (!cached || cached.id !== staff.id) return
  queryClient.setQueryData<Staff>(sessionKeys.me(), staff)
}

export const registerSessionRealtime: RealtimeRegistration = (registry) => {
  registry.register('me.updated', applyMe)
}
