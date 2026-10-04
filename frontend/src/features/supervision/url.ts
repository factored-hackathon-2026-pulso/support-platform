/**
 * URL state of the supervision screens (slice 3 §8, slice 9): "Colas"
 * (`/supervision/queues?language=&status=&priority=&analyst=`), "Equipo"
 * (`/supervision/team?status=&language=&team=&analyst=&reassign=`), "Escalados"
 * (`/supervision/escalations?escalation=&reassign=`) and the read-only case view
 * (`/supervision/cases/:caseId?previous=&reassign=`). Values are the API enums and ids;
 * multi-value filters are comma-separated. Links into these screens are built in
 * app/paths.ts. Pure: unit-tested in url.test.ts.
 */
import type { CasePriority } from '@/features/cases'
import type { PreviousCasesSelection } from '@/features/conversation'
import {
  ACTIVITY_ORDER,
  OPEN_CASE_STATUS_KEYS,
  QUEUE_LANGUAGES,
  type OpenCaseStatusKey,
} from './model'
import type { AnalystActivity, Language } from './types'

export interface UrlStateChangeOptions {
  /** Replace the history entry (filters) instead of pushing one (selection, dialogs). */
  replace?: boolean
}

/** "a,b,,c " → ["a", "b", "c"]: unique, trimmed, empty ones dropped. */
function listParam(params: URLSearchParams, name: string): string[] {
  const values = (params.get(name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return [...new Set(values)]
}

/** The known values of a list param, in their canonical order. */
function knownValues<K extends string>(
  order: readonly K[],
  params: URLSearchParams,
  name: string,
): K[] {
  const values = listParam(params, name)
  return order.filter((value) => values.includes(value))
}

const trimmed = (value: string | null) => value?.trim() || null

// ── "Colas" ──────────────────────────────────────────────────────────────────

export interface QueuesUrlState {
  /** `?language=es|pt` (default `es`). */
  language: Language
  /** `?status=queued,new,to_reply,waiting`. */
  statuses: OpenCaseStatusKey[]
  /** `?priority=none,low,medium,high,critical`. */
  priorities: CasePriority[]
  /** `?analyst=STF-…,STF-…`: who holds the case. */
  analysts: string[]
}

const PRIORITY_ORDER: readonly CasePriority[] = ['none', 'low', 'medium', 'high', 'critical']

export function parseQueuesSearch(params: URLSearchParams): QueuesUrlState {
  return {
    language: params.get('language') === 'pt' ? 'pt' : 'es',
    statuses: knownValues(OPEN_CASE_STATUS_KEYS, params, 'status'),
    priorities: knownValues(PRIORITY_ORDER, params, 'priority'),
    analysts: listParam(params, 'analyst'),
  }
}

export function toQueuesSearch(state: QueuesUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.language !== 'es') params.set('language', state.language)
  if (state.statuses.length) params.set('status', state.statuses.join(','))
  if (state.priorities.length) params.set('priority', state.priorities.join(','))
  if (state.analysts.length) params.set('analyst', state.analysts.join(','))
  return params
}

// ── "Equipo" ─────────────────────────────────────────────────────────────────

export interface TeamUrlState {
  /** `?status=busy,available,paused,offline`. */
  activities: AnalystActivity[]
  /** `?language=es,pt`. */
  languages: Language[]
  /** `?team=TEAM-…,TEAM-…`. */
  teams: string[]
  /** `?analyst=STF-…`: the analyst sheet. */
  analystId: string | null
  /** `?reassign=CASE-…`: the reassign dialog. */
  reassignCaseId: string | null
}

export function parseTeamSearch(params: URLSearchParams): TeamUrlState {
  return {
    activities: knownValues(ACTIVITY_ORDER, params, 'status'),
    languages: knownValues(QUEUE_LANGUAGES, params, 'language'),
    teams: listParam(params, 'team'),
    analystId: trimmed(params.get('analyst')),
    reassignCaseId: trimmed(params.get('reassign')),
  }
}

export function toTeamSearch(state: TeamUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.activities.length) params.set('status', state.activities.join(','))
  if (state.languages.length) params.set('language', state.languages.join(','))
  if (state.teams.length) params.set('team', state.teams.join(','))
  if (state.analystId) params.set('analyst', state.analystId)
  if (state.reassignCaseId) params.set('reassign', state.reassignCaseId)
  return params
}

// ── "Escalados" ──────────────────────────────────────────────────────────────

export interface EscalationsUrlState {
  /** `?escalation=ESC-…`: the side panel. */
  escalationId: string | null
  /** `?reassign=1`: the reassign dialog for the selected escalation's case. */
  reassign: boolean
}

export function parseEscalationsSearch(params: URLSearchParams): EscalationsUrlState {
  return {
    escalationId: trimmed(params.get('escalation')),
    reassign: params.get('reassign') === '1',
  }
}

export function toEscalationsSearch(state: EscalationsUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.escalationId) params.set('escalation', state.escalationId)
  if (state.reassign && state.escalationId) params.set('reassign', '1')
  return params
}

// ── Supervisor case view ─────────────────────────────────────────────────────

export interface CaseViewUrlState {
  /** `?previous=list|CASE-…`: the "Casos anteriores" sheet. */
  history: PreviousCasesSelection | null
  /** `?reassign=1`: the reassign dialog for this case. */
  reassign: boolean
}

export function parseCaseViewSearch(params: URLSearchParams): CaseViewUrlState {
  return {
    history: trimmed(params.get('previous')),
    reassign: params.get('reassign') === '1',
  }
}

export function toCaseViewSearch(state: CaseViewUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.history) params.set('previous', state.history)
  if (state.reassign) params.set('reassign', '1')
  return params
}
