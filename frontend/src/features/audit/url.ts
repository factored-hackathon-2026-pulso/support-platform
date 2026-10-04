/**
 * URL state of "Auditoría" (`/supervision/audit` and `/admin/audit`, contract
 * docs/platform/api/slice-3-supervision.md §8.9):
 * `?actor=&person=&case=&type=&from=&to=&q=&changes=&event=`. Values are the API enums and
 * ids; dates are YYYY-MM-DD in the viewer's zone. Pure: unit-tested in url.test.ts.
 */
import { AUDIT_FAMILIES, AUDIT_KIND_FILTERS, AUDIT_SEARCH_MAX_LENGTH, isDateKey } from './model'
import type { AuditActorKind, AuditFamily } from './types'

export interface AuditUrlState {
  /** `?actor=staff|customer|system` ("Quién"). */
  actorKind: AuditActorKind | null
  /** `?person=STF-…`. */
  actorId: string | null
  /** `?case=CASE-…`. */
  caseId: string | null
  /** `?type=` (the API `AuditFamily`: conversation, assignment, lifecycle, …). */
  family: AuditFamily | null
  /** `?from=YYYY-MM-DD` (viewer's zone). */
  fromDate: string | null
  /** `?to=YYYY-MM-DD` (inclusive day). */
  toDate: string | null
  /** `?q=`. */
  query: string
  /** `?changes=1`. */
  changesOnly: boolean
  /** `?event=EVT-…`: the detail aside. */
  eventId: string | null
}

export interface AuditStateChangeOptions {
  /** Replace the history entry (filters) instead of pushing one (selecting an event). */
  replace?: boolean
}

const trimmed = (value: string | null) => value?.trim() || null

export function parseAuditSearch(params: URLSearchParams): AuditUrlState {
  const kind = params.get('actor')
  const family = params.get('type')
  const from = params.get('from')
  const to = params.get('to')
  return {
    actorKind: AUDIT_KIND_FILTERS.find((o) => o.value !== null && o.value === kind)?.value ?? null,
    actorId: trimmed(params.get('person')),
    caseId: trimmed(params.get('case')),
    family: AUDIT_FAMILIES.find((o) => o.value === family)?.value ?? null,
    fromDate: isDateKey(from) ? from : null,
    toDate: isDateKey(to) ? to : null,
    query: (params.get('q') ?? '').slice(0, AUDIT_SEARCH_MAX_LENGTH),
    changesOnly: params.get('changes') === '1',
    eventId: trimmed(params.get('event')),
  }
}

export function toAuditSearch(state: AuditUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.actorKind) params.set('actor', state.actorKind)
  if (state.actorId) params.set('person', state.actorId)
  if (state.caseId) params.set('case', state.caseId)
  if (state.family) params.set('type', state.family)
  if (state.fromDate) params.set('from', state.fromDate)
  if (state.toDate) params.set('to', state.toDate)
  if (state.query) params.set('q', state.query)
  if (state.changesOnly) params.set('changes', '1')
  if (state.eventId) params.set('event', state.eventId)
  return params
}
