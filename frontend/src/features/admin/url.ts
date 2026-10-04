/**
 * URL state of the administration screens (contract docs/platform/api/slice-4-administration.md
 * §10.11; slice 9: multi-value filters): "Usuarios y roles"
 * (`/admin/users?role=&status=&team=&language=&q=&person=&new=`) and "Equipos"
 * (`/admin/teams?status=&team=&new=`). Values are the API enums and ids; multi-value filters
 * are comma-separated. Links into these screens are built in app/paths.ts. Pure:
 * unit-tested in url.test.ts.
 */
import { ROLE_ORDER, type RoleId } from '@/app/roles'
import {
  ACCOUNT_STATUS_ORDER,
  LANGUAGES,
  TEAM_STATE_ORDER,
  USER_SEARCH_MAX_LENGTH,
  inOrder,
  type TeamState,
} from './model'
import type { AccountStatus, Language } from './types'

/**
 * The directory's filters (slice 9, Admin.dc.html): one "Filtros" dropdown with four
 * groups, several values per group (OR inside a group, AND across groups), as
 * comma-separated URL values. Empty = no filter on that group: everyone is listed,
 * deactivated people too (the canvas default).
 */
export interface UsersUrlState {
  /** `?role=analyst,supervisor,admin`. */
  roles: RoleId[]
  /** `?status=active,locked,invited,inactive` (the status at the screen's clock). */
  statuses: AccountStatus[]
  /** `?team=TEAM-…,TEAM-…`. */
  teamIds: string[]
  /** `?language=es,pt`. */
  languages: Language[]
  /** `?q=`. */
  query: string
  /** `?person=STF-…`: the selected person (aside). */
  staffId: string | null
  /** `?new=1`: the create dialog. */
  create: boolean
}

export interface TeamsUrlState {
  /**
   * The checked "Estado" options of "Filtros" (`?status=active,inactive`; absent = only
   * the active teams; `all` = nothing checked). None or both checked = every team.
   */
  statuses: TeamState[]
  /** `?team=TEAM-…`: the selected team (aside). */
  teamId: string | null
  /** `?new=1`: the create dialog. */
  create: boolean
}

export interface UrlStateChangeOptions {
  /** Replace the history entry (filters) instead of pushing one (selection, dialogs). */
  replace?: boolean
}

/** `?status=all`: nothing checked (every team). */
const ALL_TEAMS = 'all'

/** "a,b,,c " → ["a", "b", "c"]: unique, trimmed, empty ones dropped. */
function listParam(params: URLSearchParams, name: string): string[] {
  const values = (params.get(name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return [...new Set(values)]
}

const trimmed = (value: string | null) => value?.trim() || null

export function parseUsersSearch(params: URLSearchParams): UsersUrlState {
  return {
    roles: inOrder(ROLE_ORDER, listParam(params, 'role')),
    statuses: inOrder(ACCOUNT_STATUS_ORDER, listParam(params, 'status')),
    teamIds: listParam(params, 'team'),
    languages: inOrder(LANGUAGES, listParam(params, 'language')),
    query: (params.get('q') ?? '').slice(0, USER_SEARCH_MAX_LENGTH),
    staffId: trimmed(params.get('person')),
    create: params.get('new') === '1',
  }
}

export function toUsersSearch(state: UsersUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.roles.length) params.set('role', state.roles.join(','))
  if (state.statuses.length) params.set('status', state.statuses.join(','))
  if (state.teamIds.length) params.set('team', state.teamIds.join(','))
  if (state.languages.length) params.set('language', state.languages.join(','))
  if (state.query) params.set('q', state.query)
  if (state.staffId) params.set('person', state.staffId)
  if (state.create) params.set('new', '1')
  return params
}

export function parseTeamsSearch(params: URLSearchParams): TeamsUrlState {
  const values = listParam(params, 'status')
  const known = inOrder(TEAM_STATE_ORDER, values)
  const statuses: TeamState[] =
    known.length > 0 ? known : values.includes(ALL_TEAMS) ? [] : ['active']
  return {
    statuses,
    teamId: trimmed(params.get('team')),
    create: params.get('new') === '1',
  }
}

export function toTeamsSearch(state: TeamsUrlState): URLSearchParams {
  const params = new URLSearchParams()
  const onlyActive = state.statuses.length === 1 && state.statuses[0] === 'active'
  if (!onlyActive) {
    params.set(
      'status',
      state.statuses.length === 0 ? ALL_TEAMS : inOrder(TEAM_STATE_ORDER, state.statuses).join(','),
    )
  }
  if (state.teamId) params.set('team', state.teamId)
  if (state.create) params.set('new', '1')
  return params
}
