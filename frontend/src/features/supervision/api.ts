/**
 * Supervision calls (docs/platform/api/slice-3-supervision.md §4.1): the team
 * and queue overviews and the manual assignment command. The only module of the
 * feature that talks to the API client; tests mock it with
 * `vi.mock('@/features/supervision/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type { AssignmentResult, QueueOverview, SetAssigneeRequest, TeamOverview } from './types'

/** Query keys (frozen by the contract §8.10). */
export const supervisionKeys = {
  all: ['supervision'] as const,
  team: () => ['supervision', 'team'] as const,
  queues: () => ['supervision', 'queues'] as const,
}

export const supervisionMutationKeys = {
  assign: (caseId: string) => ['supervision', caseId, 'assign'] as const,
}

/** GET /supervision/team: analysts (with their open cases), teams and the server time. */
export async function fetchTeamOverview(signal?: AbortSignal): Promise<TeamOverview> {
  return unwrap(api.GET('/api/v1/supervision/team', { signal }))
}

/** GET /supervision/queues: both language queues (always es, pt) and their counts. */
export async function fetchQueueOverview(signal?: AbortSignal): Promise<QueueOverview> {
  return unwrap(api.GET('/api/v1/supervision/queues', { signal }))
}

/**
 * PUT /supervision/cases/{caseId}/assignee: assign a queued case or reassign an
 * open one. `expectedAnalystId` is who the supervisor saw holding it (`null` =
 * queued); the same target is a 200 no-op (`changed: false`).
 */
export async function setCaseAssignee(
  caseId: string,
  body: SetAssigneeRequest,
): Promise<AssignmentResult> {
  return unwrap(
    api.PUT('/api/v1/supervision/cases/{caseId}/assignee', {
      params: { path: { caseId } },
      body,
    }),
  )
}
