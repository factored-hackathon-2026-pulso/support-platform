/**
 * Supervision calls (docs/platform/api/slice-3-supervision.md §4.1,
 * slice-9-supervision-v2.md): the team and queue overviews, every open case of a
 * language ("Colas"), the escalations ("Escalados": answer, take) and the
 * reassignment command. The only module of the feature that talks to the API
 * client; tests mock it with `vi.mock('@/features/supervision/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type {
  AssignmentResult,
  CaseSummary,
  EscalationOverview,
  EscalationResult,
  Language,
  LanguageOpenCases,
  QueueOverview,
  SetAssigneeRequest,
  TeamOverview,
  TurnPage,
} from './types'

/** Query keys (slice 3 §8.10, plus slice 9: open cases by language, escalations). */
export const supervisionKeys = {
  all: ['supervision'] as const,
  team: () => ['supervision', 'team'] as const,
  queues: () => ['supervision', 'queues'] as const,
  openCases: () => ['supervision', 'open-cases'] as const,
  openCasesOf: (language: Language) => ['supervision', 'open-cases', language] as const,
  escalations: () => ['supervision', 'escalations'] as const,
  /** The last messages of a case in the "Escalados" panel (read-only). */
  lastTurns: (caseId: string) => ['supervision', 'last-turns', caseId] as const,
}

export const supervisionMutationKeys = {
  assign: (caseId: string) => ['supervision', caseId, 'assign'] as const,
  respond: (escalationId: string) => ['supervision', escalationId, 'respond'] as const,
  take: (escalationId: string) => ['supervision', escalationId, 'take'] as const,
  /** Slice 19: "Tomar el caso" from the assistant. */
  release: (caseId: string) => ['supervision', caseId, 'assistant-release'] as const,
}

/** GET /supervision/open-cases?language= (slice 9, "Colas"): every open case of a language. */
export async function fetchOpenCases(
  language: Language,
  signal?: AbortSignal,
): Promise<LanguageOpenCases> {
  return unwrap(
    api.GET('/api/v1/supervision/open-cases', { params: { query: { language } }, signal }),
  )
}

/** GET /supervision/escalations (slice 9): open ones first, then the ones attended in 24 h. */
export async function fetchEscalations(signal?: AbortSignal): Promise<EscalationOverview> {
  return unwrap(api.GET('/api/v1/supervision/escalations', { signal }))
}

/** POST /supervision/escalations/{id}/response: answer with a note; the case stays put. */
export async function respondEscalation(
  escalationId: string,
  note: string,
): Promise<EscalationResult> {
  return unwrap(
    api.POST('/api/v1/supervision/escalations/{escalationId}/response', {
      params: { path: { escalationId } },
      body: { note },
    }),
  )
}

/** POST /supervision/escalations/{id}/take: the supervisor (also Analista) takes the case. */
export async function takeEscalatedCase(escalationId: string): Promise<EscalationResult> {
  return unwrap(
    api.POST('/api/v1/supervision/escalations/{escalationId}/take', {
      params: { path: { escalationId } },
    }),
  )
}

/** GET /cases/{caseId}/turns?limit=: the latest messages (staff view) for the panel. */
export async function fetchLastTurns(
  caseId: string,
  limit: number,
  signal?: AbortSignal,
): Promise<TurnPage> {
  return unwrap(
    api.GET('/api/v1/cases/{caseId}/turns', {
      params: { path: { caseId }, query: { limit } },
      signal,
    }),
  )
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

/**
 * POST /supervision/cases/{caseId}/assistant/release (slice 19; contract slice-14-assistant.md
 * §4.2): Supervisión takes a case from the assistant. It goes to its language queue and is placed
 * like any arrival (`queued`, or `assigned` when someone was available). `assistant_not_active`
 * when the assistant no longer holds it.
 */
export async function releaseFromAssistant(caseId: string): Promise<CaseSummary> {
  return unwrap(
    api.POST('/api/v1/supervision/cases/{caseId}/assistant/release', {
      params: { path: { caseId } },
    }),
  )
}
