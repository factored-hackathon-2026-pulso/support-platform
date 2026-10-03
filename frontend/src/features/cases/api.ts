/**
 * Cases calls (docs/platform/api/slice-2-case-lifecycle.md §5.1): the analyst inbox and the
 * analyst's own availability. The only module of the feature that talks to the
 * API client; tests mock it with `vi.mock('@/features/cases/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type { Availability, AvailabilityStatus, InboxResponse, InboxStatus } from './types'

/** Query keys (frozen by the contract, unchanged since slice 1). */
export const caseKeys = {
  all: ['cases'] as const,
  inboxes: () => ['cases', 'inbox'] as const,
  inbox: (params: { status: InboxStatus | null; q: string }) => ['cases', 'inbox', params] as const,
}

export const availabilityKeys = { me: () => ['availability', 'me'] as const }

export const caseMutationKeys = {
  updateAvailability: ['availability', 'update'] as const,
}

export interface InboxParams {
  /** `null` = Todos (the open cases); `closed` = Cerrados (the last 7 days). */
  status: InboxStatus | null
  /** Already trimmed; empty = no search. */
  q: string
}

/** GET /cases/inbox: the signed-in analyst's cases + counts over the whole inbox (incl. Cerrados). */
export async function fetchInbox(
  { status, q }: InboxParams,
  signal?: AbortSignal,
): Promise<InboxResponse> {
  const query: { status?: InboxStatus; q?: string } = {}
  if (status) query.status = status
  if (q) query.q = q
  return unwrap(api.GET('/api/v1/cases/inbox', { params: { query }, signal }))
}

/** GET /me/availability. */
export async function fetchAvailability(signal?: AbortSignal): Promise<Availability> {
  return unwrap(api.GET('/api/v1/me/availability', { signal }))
}

/** PUT /me/availability ("Disponible" / "En pausa"). Same status = no event server-side. */
export async function updateAvailability(status: AvailabilityStatus): Promise<Availability> {
  return unwrap(api.PUT('/api/v1/me/availability', { body: { status } }))
}
