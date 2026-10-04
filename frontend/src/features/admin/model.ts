/**
 * Pure rules and copy of administration (Admin.dc.html section `usuarios`,
 * contract docs/platform/api/slice-4-administration.md §1.2, §10): labels, the
 * account status at a given time, the URL state of both screens, the user
 * draft (diff, validation, guard rails, open-case blocks), the failure copy of
 * every problem code and the toasts. No React, no I/O: unit-tested in
 * model.test.ts.
 */
import { ROLE_LABEL, sortRoles, type RoleId } from '@/app/roles'
import type { FactItem, FilterGroup, FilterSelection, StatusAppearance } from '@/components/ui'
import { isApiProblem } from '@/lib/api'
import { formatTime, joinEs, pluralize } from '@/lib/format'
import type {
  AccountStatus,
  AdminTeam,
  AdminTeamMember,
  AdminUser,
  AdminUserFilters,
  Language,
  OpenCasesBlock,
  SelfChangeAction,
  StaffRole,
  TeamStatusFilter,
  UpdateUserRequest,
} from './types'

export { joinEs }

type DateInput = Date | string | number

const toMs = (value: DateInput) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime()

// ── Labels (contract §1.2) ───────────────────────────────────────────────────

/** Second line of the role checkbox cards. */
export const ROLE_DESCRIPTION: Record<RoleId, string> = {
  analyst: 'Atiende casos por chat con los clientes.',
  supervisor:
    'Ve las colas y el equipo, atiende escalamientos, reasigna casos y revisa la auditoría.',
  admin: 'Crea y edita cuentas, roles, idiomas y equipos.',
}

export const LANGUAGES: readonly Language[] = ['es', 'pt']

/** "Español" (controls) and "español" (inside a sentence). */
export const LANGUAGE_LABEL: Record<Language, string> = { es: 'Español', pt: 'Portugués' }
export const LANGUAGE_IN_SENTENCE: Record<Language, string> = { es: 'español', pt: 'portugués' }

/**
 * The one account-status map (glyph + word; the words qualify "cuenta"): check =
 * can sign in, lock = locked for a while (it asks for action), x = deactivated.
 */
export const ACCOUNT_STATUS: Readonly<Record<AccountStatus, StatusAppearance>> = {
  active: { shape: 'check', tone: 'success', label: 'Activa' },
  locked: { shape: 'lock', tone: 'warn', label: 'Bloqueada', strong: true },
  inactive: { shape: 'cross', tone: 'closed', label: 'Desactivada' },
}

/** Account status words (selects, sentences). */
export const ACCOUNT_STATUS_LABEL: Readonly<Record<AccountStatus, string>> = {
  active: ACCOUNT_STATUS.active.label,
  locked: ACCOUNT_STATUS.locked.label,
  inactive: ACCOUNT_STATUS.inactive.label,
}

/** The one team-status map: the same glyphs as an account ("Activo" / "Inactivo"). */
export const TEAM_STATUS: Readonly<Record<'active' | 'inactive', StatusAppearance>> = {
  active: { shape: 'check', tone: 'success', label: 'Activo' },
  inactive: { shape: 'cross', tone: 'closed', label: 'Inactivo' },
}

export function teamStatus(team: Pick<AdminTeam, 'active'>): StatusAppearance {
  return TEAM_STATUS[team.active ? 'active' : 'inactive']
}

/** "español, portugués", or "—" without languages. */
export function languagesLabel(languages: readonly Language[]): string {
  const sorted = LANGUAGES.filter((language) => languages.includes(language))
  return sorted.length > 0
    ? sorted.map((language) => LANGUAGE_IN_SENTENCE[language]).join(', ')
    : '—'
}

/** "Equipo Andes (inactivo)" for options naming an inactive team. */
export function teamOptionLabel(team: Pick<AdminTeam, 'name' | 'active'>): string {
  return team.active ? team.name : `${team.name} (inactivo)`
}

/** By name, accent-insensitive, then id (the server order, §4.1). */
export function byName(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id)
}

// ── Account status (contract §1.1, §10.2) ────────────────────────────────────

/**
 * The status at `now`: the server computes it at `serverTime`, but a lock
 * expires on its own, so the screen recomputes it from `lockedUntil` with a
 * ticking clock (an expired lock reads "Activa").
 */
export function accountStatusAt(
  user: Pick<AdminUser, 'status' | 'lockedUntil'>,
  now: DateInput,
): AccountStatus {
  if (user.status === 'inactive') return 'inactive'
  if (user.lockedUntil && toMs(user.lockedUntil) > toMs(now)) return 'locked'
  return 'active'
}

/** `title` of a locked status: "Hasta las 10:47". */
export function lockedUntilTitle(lockedUntil: string): string {
  return `Hasta las ${formatTime(lockedUntil)}`
}

/** Status callout of the aside (null while active). */
export function statusCallout(
  user: Pick<AdminUser, 'status' | 'lockedUntil' | 'failedAttempts'>,
  now: DateInput,
): {
  tone: 'warn' | 'neutral'
  title: string
  text: string
  action: 'unlock' | 'reactivate'
} | null {
  const status = accountStatusAt(user, now)
  if (status === 'locked' && user.lockedUntil) {
    return {
      tone: 'warn',
      title: 'Cuenta bloqueada',
      text: `${pluralize(user.failedAttempts, 'intento fallido', 'intentos fallidos')}. Se desbloquea sola a las ${formatTime(user.lockedUntil)}.`,
      action: 'unlock',
    }
  }
  if (status === 'inactive') {
    return {
      tone: 'neutral',
      title: 'Cuenta desactivada',
      text: 'No puede ingresar.',
      action: 'reactivate',
    }
  }
  return null
}

/** "Casos abiertos": "5 · 4 en español · 1 en portugués", "0". */
export function openCasesFact(openCases: AdminUser['openCases']): string {
  if (openCases.total === 0) return '0'
  const parts = LANGUAGES.filter((language) => openCases[language] > 0).map(
    (language) => `${openCases[language]} en ${LANGUAGE_IN_SENTENCE[language]}`,
  )
  return [String(openCases.total), ...parts].join(' · ')
}

/**
 * Aside facts under the name (slice 6 UI rule: structured items, never a
 * dot-joined line; the roles are chips next to them): [languages] "Español y
 * portugués", [users] the team.
 */
export function userSummaryFacts(user: Pick<AdminUser, 'languages' | 'team'>): FactItem[] {
  const sorted = LANGUAGES.filter((language) => user.languages.includes(language))
  const spoken = joinEs(sorted.map((language) => LANGUAGE_IN_SENTENCE[language]))
  return [
    {
      key: 'languages',
      icon: 'languages',
      text: spoken ? spoken.charAt(0).toUpperCase() + spoken.slice(1) : 'Sin idiomas',
      label: 'Idiomas',
    },
    { key: 'team', icon: 'users', text: user.team.name, label: 'Equipo' },
  ]
}

// ── URL state (contract §10.11; slice 9: multi-value filters) ──────────────────

/**
 * The directory's filters (slice 9, Admin.dc.html): one "Filtros" dropdown with four
 * groups, several values per group (OR inside a group, AND across groups), as
 * comma-separated URL values. Empty = no filter on that group: everyone is listed,
 * deactivated people too (the canvas default).
 */
export interface UsersUrlState {
  /** `?rol=analistas,supervision,administracion`. */
  roles: RoleId[]
  /** `?estado=activas,bloqueadas,desactivadas` (the status at the screen's clock). */
  statuses: AccountStatus[]
  /** `?equipo=TEAM-…,TEAM-…`. */
  teamIds: string[]
  /** `?idioma=es,pt`. */
  languages: Language[]
  /** `?q=`. */
  query: string
  /** `?persona=STF-…`: the selected person (aside). */
  staffId: string | null
  /** `?nueva=1`: the create dialog. */
  create: boolean
}

/** A team state the "Filtros" dropdown of Equipos can check. */
export type TeamState = 'active' | 'inactive'

export interface TeamsUrlState {
  /**
   * The checked "Estado" options of "Filtros" (`?estado=activos,inactivos`; absent = only
   * the active teams; `todos` = nothing checked). None or both checked = every team.
   */
  statuses: TeamState[]
  /** `?equipo=TEAM-…`: the selected team (aside). */
  teamId: string | null
  /** `?nuevo=1`: the create dialog. */
  create: boolean
}

export interface UrlStateChangeOptions {
  /** Replace the history entry (filters) instead of pushing one (selection, dialogs). */
  replace?: boolean
}

const ROLE_SLUGS: Record<RoleId, string> = {
  analyst: 'analistas',
  supervisor: 'supervision',
  admin: 'administracion',
}

/** Older links (slice 4) still open the same filter. */
const ROLE_SLUG_ALIASES: Record<string, RoleId> = { supervisoras: 'supervisor' }

const ACCOUNT_STATUS_SLUGS: Record<AccountStatus, string> = {
  active: 'activas',
  locked: 'bloqueadas',
  inactive: 'desactivadas',
}

const TEAM_STATUS_SLUGS: Record<TeamState, string> = {
  active: 'activos',
  inactive: 'inactivos',
}

/** `?estado=todos`: nothing checked (every team). */
const ALL_TEAMS_SLUG = 'todos'

const TEAM_STATE_ORDER: readonly TeamState[] = ['active', 'inactive']

/** Max length of `q` (the API accepts 1–80). */
export const USER_SEARCH_MAX_LENGTH = 80

function fromSlug<K extends string>(slugs: Record<K, string>, slug: string | null): K | null {
  if (!slug) return null
  const entry = (Object.entries(slugs) as [K, string][]).find(([, value]) => value === slug)
  return entry ? entry[0] : null
}

/** "a,b,,c " → ["a", "b", "c"]: unique, trimmed, empty ones dropped. */
function listParam(params: URLSearchParams, name: string): string[] {
  const values = (params.get(name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return [...new Set(values)]
}

/** Known values in a canonical order (unknown slugs dropped). */
function inOrder<K extends string>(order: readonly K[], values: readonly (K | null)[]): K[] {
  return order.filter((value) => values.includes(value))
}

const trimmed = (value: string | null) => value?.trim() || null

export const EMPTY_USERS_STATE: UsersUrlState = {
  roles: [],
  statuses: [],
  teamIds: [],
  languages: [],
  query: '',
  staffId: null,
  create: false,
}

const ACCOUNT_STATUS_ORDER: readonly AccountStatus[] = ['active', 'locked', 'inactive']

export function parseUsersSearch(params: URLSearchParams): UsersUrlState {
  const roles = listParam(params, 'rol').map(
    (slug) => fromSlug(ROLE_SLUGS, slug) ?? ROLE_SLUG_ALIASES[slug] ?? null,
  )
  const statuses = listParam(params, 'estado').map((slug) => fromSlug(ACCOUNT_STATUS_SLUGS, slug))
  const languages = listParam(params, 'idioma').map((value) =>
    value === 'es' || value === 'pt' ? value : null,
  )
  return {
    roles: inOrder<RoleId>(['analyst', 'supervisor', 'admin'], roles),
    statuses: inOrder(ACCOUNT_STATUS_ORDER, statuses),
    teamIds: listParam(params, 'equipo'),
    languages: inOrder(LANGUAGES, languages),
    query: (params.get('q') ?? '').slice(0, USER_SEARCH_MAX_LENGTH),
    staffId: trimmed(params.get('persona')),
    create: params.get('nueva') === '1',
  }
}

export function toUsersSearch(state: UsersUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.roles.length) params.set('rol', state.roles.map((r) => ROLE_SLUGS[r]).join(','))
  if (state.statuses.length) {
    params.set('estado', state.statuses.map((s) => ACCOUNT_STATUS_SLUGS[s]).join(','))
  }
  if (state.teamIds.length) params.set('equipo', state.teamIds.join(','))
  if (state.languages.length) params.set('idioma', state.languages.join(','))
  if (state.query) params.set('q', state.query)
  if (state.staffId) params.set('persona', state.staffId)
  if (state.create) params.set('nueva', '1')
  return params
}

export function parseTeamsSearch(params: URLSearchParams): TeamsUrlState {
  const slugs = listParam(params, 'estado')
  const known = inOrder(
    TEAM_STATE_ORDER,
    slugs.map((slug) => fromSlug(TEAM_STATUS_SLUGS, slug)),
  )
  const statuses: TeamState[] =
    known.length > 0 ? known : slugs.includes(ALL_TEAMS_SLUG) ? [] : ['active']
  return {
    statuses,
    teamId: trimmed(params.get('equipo')),
    create: params.get('nuevo') === '1',
  }
}

export function toTeamsSearch(state: TeamsUrlState): URLSearchParams {
  const params = new URLSearchParams()
  const onlyActive = state.statuses.length === 1 && state.statuses[0] === 'active'
  if (!onlyActive) {
    params.set(
      'estado',
      state.statuses.length === 0
        ? ALL_TEAMS_SLUG
        : inOrder(TEAM_STATE_ORDER, state.statuses)
            .map((status) => TEAM_STATUS_SLUGS[status])
            .join(','),
    )
  }
  if (state.teamId) params.set('equipo', state.teamId)
  if (state.create) params.set('nuevo', '1')
  return params
}

/**
 * URL state → GET /admin/users. The server filters one value per field, the dropdown
 * combines several: the screen asks once for everyone (`status=all`, the ≤ 500-row
 * directory the server already filters in memory) with the search only, and the
 * groups filter here (`filterUsers`), so the faceted counts need no extra request.
 */
export function usersQueryOf(state: UsersUrlState): AdminUserFilters {
  const filters: AdminUserFilters = { status: 'all' }
  const q = state.query.trim().slice(0, USER_SEARCH_MAX_LENGTH)
  if (q) filters.q = q
  return filters
}

/** Any list filter set (the selection and the dialog are not filters). */
export function hasUserFilters(state: UsersUrlState): boolean {
  return (
    state.roles.length > 0 ||
    state.statuses.length > 0 ||
    state.teamIds.length > 0 ||
    state.languages.length > 0 ||
    state.query.trim() !== ''
  )
}

/** "Limpiar filtros": every filter back to its default; the selection stays. */
export function clearUserFilters(state: UsersUrlState): UsersUrlState {
  return { ...EMPTY_USERS_STATE, staffId: state.staffId }
}

// ── "Filtros" of the directory (slice 9) ─────────────────────────────────────

/** The four groups of the dropdown, in order. */
export type UserFilterKey = 'role' | 'status' | 'team' | 'language'

const USER_FILTER_KEYS: readonly UserFilterKey[] = ['role', 'status', 'team', 'language']

/** The URL state as the dropdown's selection. */
export function userFilterSelection(state: UsersUrlState): Record<UserFilterKey, string[]> {
  return {
    role: [...state.roles],
    status: [...state.statuses],
    team: [...state.teamIds],
    language: [...state.languages],
  }
}

/** The dropdown's selection back into the URL state (unknown values dropped). */
export function usersPatchOfSelection(selection: FilterSelection): Partial<UsersUrlState> {
  const of = (key: UserFilterKey) => selection[key] ?? []
  return {
    roles: inOrder<RoleId>(['analyst', 'supervisor', 'admin'], of('role') as RoleId[]),
    statuses: inOrder(ACCOUNT_STATUS_ORDER, of('status') as AccountStatus[]),
    teamIds: [...of('team')],
    languages: inOrder(LANGUAGES, of('language') as Language[]),
  }
}

/** Whether `user` matches one option of a group (the status at `now`: locks expire). */
export function matchesUserFilter(
  user: AdminUser,
  key: UserFilterKey,
  value: string,
  now: DateInput,
): boolean {
  switch (key) {
    case 'role':
      return user.roles.includes(value as StaffRole)
    case 'status':
      return accountStatusAt(user, now) === value
    case 'team':
      return user.team.id === value
    case 'language':
      return user.languages.includes(value as Language)
  }
}

function passesGroup(
  user: AdminUser,
  key: UserFilterKey,
  selection: FilterSelection,
  now: DateInput,
): boolean {
  const values = selection[key] ?? []
  return values.length === 0 || values.some((value) => matchesUserFilter(user, key, value, now))
}

/** The rows that pass every group (`except` one, for its faceted counts). */
export function filterUsers(
  users: readonly AdminUser[],
  selection: FilterSelection,
  now: DateInput,
  except: UserFilterKey | null = null,
): AdminUser[] {
  return users.filter((user) =>
    USER_FILTER_KEYS.every((key) => key === except || passesGroup(user, key, selection, now)),
  )
}

/**
 * The groups of "Filtros" with faceted counts: how many people would show with this
 * option, the search and every **other** group applied (Admin.dc.html `passAll`).
 * Rol, Estado, Equipo (active teams first; an inactive one says so; a team from the URL
 * nobody knows is kept by its id), Idioma.
 */
export function userFilterGroups(
  users: readonly AdminUser[],
  teams: readonly AdminTeam[],
  selection: FilterSelection,
  now: DateInput,
): FilterGroup[] {
  const counted = (key: UserFilterKey, options: { value: string; label: string }[]) => {
    const base = filterUsers(users, selection, now, key)
    return {
      key,
      options: options.map((option) => ({
        ...option,
        count: base.filter((user) => matchesUserFilter(user, key, option.value, now)).length,
      })),
    }
  }
  const teamOptions = teams
    .slice()
    .sort((a, b) => Number(b.active) - Number(a.active) || byName(a, b))
    .map((team) => ({ value: team.id, label: teamOptionLabel(team) }))
  for (const teamId of selection.team ?? []) {
    if (!teamOptions.some((option) => option.value === teamId)) {
      teamOptions.push({ value: teamId, label: teamId })
    }
  }
  return [
    {
      ...counted(
        'role',
        (['analyst', 'supervisor', 'admin'] as const).map((role) => ({
          value: role,
          label: ROLE_LABEL[role],
        })),
      ),
      legend: 'Rol',
    },
    {
      ...counted(
        'status',
        ACCOUNT_STATUS_ORDER.map((status) => ({
          value: status,
          label: ACCOUNT_STATUS_LABEL[status],
        })),
      ),
      legend: 'Estado',
    },
    { ...counted('team', teamOptions), legend: 'Equipo' },
    {
      ...counted(
        'language',
        LANGUAGES.map((language) => ({ value: language, label: LANGUAGE_LABEL[language] })),
      ),
      legend: 'Idioma',
    },
  ]
}

/** "13 personas", or "4 de 13 personas" while filtered. */
export function usersShownLabel(shown: number, total: number): string {
  const all = pluralize(total, 'persona')
  return shown === total ? all : `${shown} de ${all}`
}

/** Header subtitle (canvas `usersSub`): "13 personas en la plataforma" (never " · " joined). */
export function usersSubtitle(total: number | undefined): string {
  return total === undefined
    ? 'Quién puede hacer qué en la plataforma'
    : `${pluralize(total, 'persona')} en la plataforma`
}

/** Header subtitle (canvas `teamsSub`): "4 equipos en la plataforma" (never " · " joined). */
export function teamsSubtitle(total: number | undefined): string {
  return total === undefined
    ? 'Cómo se agrupan las personas en la plataforma'
    : `${pluralize(total, 'equipo')} en la plataforma`
}

// ── "Filtros" of Equipos (Admin.dc.html `tf`) ────────────────────────────────

/** The one group key of the Equipos dropdown. */
export const TEAM_FILTER_KEY = 'status'

/** The status the API filters by: one checked state, or every team (none or both). */
export function teamsQueryStatus(statuses: readonly TeamState[]): TeamStatusFilter {
  return statuses.length === 1 ? statuses[0]! : 'all'
}

/** The URL state as the dropdown's selection. */
export function teamFilterSelection(state: Pick<TeamsUrlState, 'statuses'>): FilterSelection {
  return { [TEAM_FILTER_KEY]: [...state.statuses] }
}

/** The dropdown's selection back into the URL state (unknown values dropped). */
export function teamsPatchOfSelection(selection: FilterSelection): Pick<TeamsUrlState, 'statuses'> {
  return {
    statuses: inOrder(TEAM_STATE_ORDER, (selection[TEAM_FILTER_KEY] ?? []) as TeamState[]),
  }
}

/** "Estado": Activos / Inactivos, each with its count from the server. */
export function teamFilterGroups(
  counts: { active: number; inactive: number } | undefined,
): FilterGroup[] {
  return [
    {
      key: TEAM_FILTER_KEY,
      legend: 'Estado',
      options: TEAM_STATE_ORDER.map((status) => ({
        value: status,
        label: status === 'active' ? 'Activos' : 'Inactivos',
        ...(counts ? { count: counts[status] } : {}),
      })),
    },
  ]
}

/** "4 equipos", or "3 de 4 equipos" while a filter hides some (canvas `shownLabel`). */
export function teamsShownLabel(shown: number, total: number): string {
  const all = pluralize(total, 'equipo')
  return shown === total ? all : `${shown} de ${all}`
}

// ── The user draft (contract §10.2–§10.4) ────────────────────────────────────

export interface UserDraft {
  name: string
  email: string
  roles: RoleId[]
  languages: Language[]
  /** '' = none chosen yet (create). */
  teamId: string
}

export type UserDraftField = keyof UserDraft

/** Fields in form order: the first invalid one gets the focus. */
export const USER_DRAFT_FIELDS: readonly UserDraftField[] = [
  'name',
  'email',
  'roles',
  'languages',
  'teamId',
]

export type UserDraftErrors = Partial<Record<UserDraftField, string>>

export const EMPTY_USER_DRAFT: UserDraft = {
  name: '',
  email: '',
  roles: [],
  languages: [],
  teamId: '',
}

/** Team-generated limits (contract §1.3). */
export const NAME_MAX_LENGTH = 120
export const TEAM_NAME_MAX_LENGTH = 80
export const EMAIL_MAX_LENGTH = 254

/** Trimmed, inner runs of spaces collapsed to one (the domain rule). */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export const FIELD_ERROR: Record<UserDraftField, string> = {
  name: 'Escribe el nombre completo (al menos 2 caracteres).',
  email: 'Escribe un correo válido, como nombre@latambank.example.',
  roles: 'Elige al menos un rol.',
  languages: 'Quien atiende casos necesita al menos un idioma.',
  teamId: 'Elige un equipo.',
}

export const TEAM_NAME_ERROR = 'Escribe un nombre de al menos 2 caracteres.'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Client validation before any request (contract §10.4). */
export function validateUserDraft(draft: UserDraft): UserDraftErrors {
  const errors: UserDraftErrors = {}
  const name = normalizeName(draft.name)
  if (name.length < 2 || name.length > NAME_MAX_LENGTH) errors.name = FIELD_ERROR.name
  const email = draft.email.trim()
  if (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX_LENGTH)
    errors.email = FIELD_ERROR.email
  if (draft.roles.length === 0) errors.roles = FIELD_ERROR.roles
  if (draft.roles.includes('analyst') && draft.languages.length === 0) {
    errors.languages = FIELD_ERROR.languages
  }
  if (!draft.teamId) errors.teamId = FIELD_ERROR.teamId
  return errors
}

export function validateTeamName(name: string): string | null {
  const normalized = normalizeName(name)
  return normalized.length < 2 || normalized.length > TEAM_NAME_MAX_LENGTH ? TEAM_NAME_ERROR : null
}

/** The first field with an error, in form order (it gets the focus). */
export function firstInvalidField(errors: UserDraftErrors): UserDraftField | null {
  return USER_DRAFT_FIELDS.find((field) => errors[field]) ?? null
}

export function draftFromUser(user: AdminUser): UserDraft {
  return {
    name: user.name,
    email: user.email,
    roles: sortRoles(user.roles),
    languages: LANGUAGES.filter((language) => user.languages.includes(language)),
    teamId: user.team.id,
  }
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value) => b.includes(value))

/**
 * What the draft changes on `base` (the person the admin started editing): only
 * the changed fields, normalized, in the shape of the PATCH body.
 */
export function userChanges(
  base: AdminUser,
  draft: UserDraft,
): Omit<UpdateUserRequest, 'expectedVersion'> {
  const changes: Omit<UpdateUserRequest, 'expectedVersion'> = {}
  const name = normalizeName(draft.name)
  if (name !== base.name) changes.name = name
  if (normalizeEmail(draft.email) !== normalizeEmail(base.email)) changes.email = draft.email.trim()
  if (!sameSet(draft.roles, base.roles)) changes.roles = sortRoles(draft.roles)
  if (!sameSet(draft.languages, base.languages)) {
    changes.languages = LANGUAGES.filter((language) => draft.languages.includes(language))
  }
  if (draft.teamId !== base.team.id) changes.teamId = draft.teamId
  return changes
}

export function isDraftDirty(base: AdminUser, draft: UserDraft): boolean {
  return Object.keys(userChanges(base, draft)).length > 0
}

/** POST /admin/users body from a valid draft. */
export function createUserBody(draft: UserDraft) {
  return {
    name: normalizeName(draft.name),
    email: draft.email.trim(),
    roles: sortRoles(draft.roles),
    languages: LANGUAGES.filter((language) => draft.languages.includes(language)),
    teamId: draft.teamId,
  }
}

export function toggleValue<T extends string>(values: readonly T[], value: T, on: boolean): T[] {
  return on
    ? values.includes(value)
      ? [...values]
      : [...values, value]
    : values.filter((v) => v !== value)
}

// ── Guard rails (contract §10.2) ─────────────────────────────────────────────

export const SELF_CHANGE_COPY: Record<SelfChangeAction, string> = {
  remove_own_admin: 'No puedes quitarte tu propio rol de Administración.',
  deactivate_self: 'No puedes desactivar tu propia cuenta.',
  reset_own_password: 'Pídele a otra persona de Administración que restablezca tu contraseña.',
}

export const LAST_ADMIN_HINT = 'Es la única persona activa con Administración.'

export interface UserGuardState {
  /** The Administración card cannot be unchecked; the text replaces its description. */
  adminLocked: string | null
  /** "Desactivar cuenta" disabled, with this hint. */
  deactivateBlocked: string | null
  /** "Restablecer contraseña" disabled, with this hint. */
  resetBlocked: string | null
}

export function userGuardState(user: Pick<AdminUser, 'guards'>): UserGuardState {
  if (user.guards.isSelf) {
    return {
      adminLocked: SELF_CHANGE_COPY.remove_own_admin,
      deactivateBlocked: SELF_CHANGE_COPY.deactivate_self,
      resetBlocked: SELF_CHANGE_COPY.reset_own_password,
    }
  }
  if (user.guards.lastActiveAdmin) {
    return { adminLocked: LAST_ADMIN_HINT, deactivateBlocked: LAST_ADMIN_HINT, resetBlocked: null }
  }
  return { adminLocked: null, deactivateBlocked: null, resetBlocked: null }
}

const openCasesPrefix = (count: number) =>
  `Tiene ${pluralize(count, 'caso abierto', 'casos abiertos')}`

export function removeAnalystBlockedCopy(count: number): string {
  return `${openCasesPrefix(count)}: supervisión tiene que reasignarlos antes de quitarle el rol de Analista.`
}

export function removeLanguageBlockedCopy(count: number, language: Language): string {
  return `${openCasesPrefix(count)} en ${LANGUAGE_IN_SENTENCE[language]}: supervisión tiene que reasignarlos antes de quitarle ese idioma.`
}

/** Title and detail of the "can't deactivate yet" callout. */
export function deactivateBlockedCopy(count: number): { title: string; text: string } {
  return {
    title: 'Primero hay que reasignar sus casos',
    text: `${openCasesPrefix(count)}. Supervisión los reasigna desde Equipo.`,
  }
}

/**
 * Changes the open cases block (§3.6), checked at submit before any request:
 * unchecking Analista while she holds open cases, or a language of one of them.
 */
export function openCaseBlocks(
  user: Pick<AdminUser, 'roles' | 'languages' | 'openCases'>,
  draft: Pick<UserDraft, 'roles' | 'languages'>,
): UserDraftErrors {
  const errors: UserDraftErrors = {}
  if (user.roles.includes('analyst') && !draft.roles.includes('analyst')) {
    if (user.openCases.total > 0) errors.roles = removeAnalystBlockedCopy(user.openCases.total)
  }
  const removed = LANGUAGES.find(
    (language) =>
      user.languages.includes(language) &&
      !draft.languages.includes(language) &&
      user.openCases[language] > 0,
  )
  if (removed) errors.languages = removeLanguageBlockedCopy(user.openCases[removed], removed)
  return errors
}

// ── Failures (contract §10.4) ────────────────────────────────────────────────

/** What the screen does after a failure, besides showing the message. */
export type AdminFailureAction =
  /** Nothing else. */
  | 'none'
  /** `current` replaces the cached record and the draft. */
  | 'use_current'
  /** Refetch the record (and the lists). */
  | 'refetch'
  /** Refetch the teams (one became inactive). */
  | 'refetch_teams'

export interface AdminFailure {
  message: string
  /** The form field the message belongs to (field error + focus). */
  field?: UserDraftField
  action: AdminFailureAction
}

export interface AdminFailureContext {
  subject: 'user' | 'team'
}

export const GENERIC_SAVE_ERROR = 'No pudimos guardar los cambios. Inténtalo de nuevo.'

function isUserField(value: string | null): value is UserDraftField {
  return value !== null && (USER_DRAFT_FIELDS as readonly string[]).includes(value)
}

function isLanguage(value: string | null): value is Language {
  return value === 'es' || value === 'pt'
}

export function teamNotEmptyCopy(memberCount: number): string {
  return memberCount === 1
    ? 'Para desactivarlo, primero mueve a su persona a otro equipo.'
    : `Para desactivarlo, primero mueve a sus ${memberCount} personas a otro equipo.`
}

export function describeAdminFailure(error: unknown, context: AdminFailureContext): AdminFailure {
  if (!isApiProblem(error)) return { message: GENERIC_SAVE_ERROR, action: 'none' }
  switch (error.code) {
    case 'version_conflict':
      return {
        message: `Alguien más cambió ${context.subject === 'user' ? 'a esta persona' : 'este equipo'} mientras editabas. Cargamos los datos actuales: revisa y vuelve a guardar.`,
        action: 'use_current',
      }
    case 'email_taken':
      return { message: 'Ya existe una cuenta con ese correo.', field: 'email', action: 'none' }
    case 'team_name_taken':
      return { message: 'Ya existe un equipo con ese nombre.', field: 'name', action: 'none' }
    case 'self_change_forbidden': {
      const action = error.stringExtension('action') as SelfChangeAction | null
      const message = action && action in SELF_CHANGE_COPY ? SELF_CHANGE_COPY[action] : null
      return {
        message: message ?? GENERIC_SAVE_ERROR,
        ...(action === 'remove_own_admin' ? { field: 'roles' as const } : {}),
        action: 'none',
      }
    }
    case 'last_admin':
      return {
        message: 'Debe quedar al menos una persona activa con Administración.',
        action: 'refetch',
      }
    case 'staff_has_open_cases': {
      const reason = error.stringExtension('blockReason') as OpenCasesBlock | null
      const count = error.numberExtension('openCases') ?? 0
      const language = error.stringExtension('caseLanguage')
      if (reason === 'remove_analyst') {
        return { message: removeAnalystBlockedCopy(count), field: 'roles', action: 'refetch' }
      }
      if (reason === 'remove_language' && isLanguage(language)) {
        return {
          message: removeLanguageBlockedCopy(count, language),
          field: 'languages',
          action: 'refetch',
        }
      }
      return {
        message: `${openCasesPrefix(count)}. Supervisión tiene que reasignarlos antes de desactivar la cuenta.`,
        action: 'refetch',
      }
    }
    case 'team_not_empty':
      return {
        message: teamNotEmptyCopy(error.numberExtension('memberCount') ?? 0),
        action: 'refetch',
      }
    case 'team_inactive':
      return {
        message: 'Ese equipo está desactivado. Elige otro.',
        field: 'teamId',
        action: 'refetch_teams',
      }
    case 'staff_inactive':
      return { message: 'Esta cuenta está desactivada. Reactívala primero.', action: 'refetch' }
    case 'invalid_value': {
      const field = error.stringExtension('field')
      if (context.subject === 'team' && field === 'name') {
        return { message: TEAM_NAME_ERROR, field: 'name', action: 'none' }
      }
      if (isUserField(field)) return { message: FIELD_ERROR[field], field, action: 'none' }
      return { message: GENERIC_SAVE_ERROR, action: 'none' }
    }
    default:
      return { message: GENERIC_SAVE_ERROR, action: 'none' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `current` of a `version_conflict` as an `AdminUser`, or null when it is not one. */
export function readAdminUser(value: unknown): AdminUser | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.email !== 'string' ||
    typeof value.version !== 'number' ||
    !Array.isArray(value.roles) ||
    !Array.isArray(value.languages) ||
    !isRecord(value.team) ||
    !isRecord(value.openCases) ||
    !isRecord(value.guards) ||
    typeof value.status !== 'string'
  )
    return null
  return value as unknown as AdminUser
}

/** `current` of a `version_conflict` as an `AdminTeam`, or null when it is not one. */
export function readAdminTeam(value: unknown): AdminTeam | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.active !== 'boolean' ||
    typeof value.version !== 'number' ||
    typeof value.memberCount !== 'number'
  )
    return null
  return value as unknown as AdminTeam
}

// ── Toasts and dialog copy (contract §10.3, §10.5) ───────────────────────────

/** "Daniela" from "Daniela Ríos". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

const sessionsClosed = (revoked: number) => {
  if (revoked <= 0) return ''
  return revoked === 1 ? ' Se cerró su sesión.' : ` Se cerraron sus ${revoked} sesiones.`
}

export function deactivatedToast(name: string, revokedSessions: number) {
  return {
    title: 'Cuenta desactivada',
    description: `${name} ya no puede ingresar.${sessionsClosed(revokedSessions)}`,
  }
}

export function reactivatedToast(name: string) {
  return {
    title: 'Cuenta reactivada',
    description: `${name} puede volver a ingresar con su contraseña. Empieza En pausa.`,
  }
}

export function unlockedToast(name: string, changed: boolean) {
  return changed
    ? { title: 'Cuenta desbloqueada', description: `${name} ya puede volver a intentar ingresar.` }
    : { title: 'La cuenta ya no estaba bloqueada.' }
}

/** Text of the temporary-password dialog. */
export function temporaryPasswordCopy(name: string, kind: 'created' | 'reset') {
  return {
    title: kind === 'created' ? 'Cuenta creada' : 'Contraseña restablecida',
    text: `${name} ya puede ingresar con su correo y esta contraseña temporal. Cópiala ahora: no la volveremos a mostrar.`,
  }
}

export const REPLAYED_PASSWORD_COPY =
  'La contraseña temporal se mostró al crear la cuenta. Si no la tienes, restablécela.'

export const DEACTIVATE_CONSEQUENCES: readonly string[] = [
  'No podrá ingresar.',
  'Se cierran sus sesiones abiertas ahora.',
  'Deja de recibir casos y queda En pausa.',
  'Su historial y la auditoría se conservan.',
]

// ── Teams (contract §10.5) ───────────────────────────────────────────────────

/** "Agregar persona" options: active people outside the team, "{nombre} · {equipo actual}". */
export function addMemberCandidates(
  users: readonly AdminUser[],
  teamId: string,
): { value: string; label: string; user: AdminUser }[] {
  return users
    .filter((user) => user.status !== 'inactive' && user.team.id !== teamId)
    .slice()
    .sort(byName)
    .map((user) => ({ value: user.id, label: `${user.name} · ${user.team.name}`, user }))
}

/** Members: active first, then inactive; each by name. */
export function sortMembers(members: readonly AdminTeamMember[]): AdminTeamMember[] {
  return members.slice().sort((a, b) => {
    const inactive = Number(a.status === 'inactive') - Number(b.status === 'inactive')
    return inactive !== 0 ? inactive : byName(a, b)
  })
}
