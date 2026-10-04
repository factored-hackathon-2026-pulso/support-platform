import {
  CircleArrowUp,
  House,
  Inbox,
  MessageSquare,
  Shield,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import type { AvatarTone } from '@/components/ui'
import { joinEs } from '@/lib/format'

/** Same values as the API `StaffRole` enum. */
export type RoleId = 'analyst' | 'supervisor' | 'admin'

/**
 * Live signals a rail destination can show. Each key is fed by the feature that
 * owns the data (app/rail-indicators.ts); a key nobody feeds shows nothing.
 */
export type RailIndicatorKey =
  /** Cases nobody holds yet, in the language queues (fed by `useQueuedCasesCount`, supervision). */
  | 'queuedCases'
  /** Open escalations to supervision (fed by `useOpenEscalationsCount`, supervision; slice 9). */
  | 'openEscalations'
  /** Accounts locked now (fed by `useLockedAccountsCount`, admin). */
  | 'lockedAccounts'
  /** Her open cases "Por responder" (fed by `useToReplyCount`, cases; slice 6). */
  | 'toReplyCases'

/** Value of one indicator: a count (orange badge) and/or a dot (something new). */
export interface RailIndicator {
  count?: number
  dot?: boolean
  /** What the count counts, for the accessible name (default "pendiente(s)"): "sin asignar". */
  noun?: readonly [singular: string, plural: string]
}

export type RailIndicators = Partial<Record<RailIndicatorKey, RailIndicator>>

/**
 * Presence dot on the rail avatar (slice 6 §4.4): the analyst's availability on
 * every analyst screen. Fed by `app/rail-indicators.ts`; absent = no dot.
 */
export interface RailPresence {
  tone: 'warn' | 'success'
  /** Accessible label of the dot: "Estado: En pausa". */
  label: string
}

/** Availability → the avatar dot: orange "En pausa", green "Disponible". */
export function presenceFor(status: 'available' | 'paused' | undefined): RailPresence | null {
  if (status === 'paused') return { tone: 'warn', label: 'Estado: En pausa' }
  if (status === 'available') return { tone: 'success', label: 'Estado: Disponible' }
  return null
}

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Live badge / dot for this destination (count from real data, never a constant). */
  indicator?: RailIndicatorKey
  /** Active only on the exact path (role landing pages). */
  end?: boolean
  /** Extra path prefixes that also mark this item as current (detail screens). */
  alsoActiveOn?: readonly string[]
}

export interface RoleDefinition {
  id: RoleId
  /** Label in the role switcher. */
  label: string
  /** URL prefix that identifies the role. */
  basePath: string
  /** Where the role lands after login or when switching to it. */
  home: string
  /** Avatar tint in the rail for this role (from the canvas). */
  avatarTone: AvatarTone
  nav: NavItem[]
}

/**
 * Role navigation, straight from the canvas rails (Workspace, SuTeam, Admin).
 * Badges and dots are not part of this static config: items name an `indicator`
 * and the rail reads its live value (app/rail-indicators.ts).
 */
export const ROLES: Record<RoleId, RoleDefinition> = {
  analyst: {
    id: 'analyst',
    label: 'Analista de casos',
    basePath: '/analista',
    // Slice 6: the analyst lands on "Inicio"; "Casos" is the Workspace.
    home: '/analista/inicio',
    avatarTone: 'accent',
    nav: [
      { to: '/analista/inicio', label: 'Inicio', icon: House },
      // `end`: /analista/inicio must not also mark "Casos" as current.
      {
        to: '/analista',
        label: 'Casos',
        icon: MessageSquare,
        indicator: 'toReplyCases',
        end: true,
      },
    ],
  },
  supervisor: {
    id: 'supervisor',
    // Gender-neutral (slice 9): the role, not a person ("Supervisión", never "Supervisora").
    label: 'Supervisión',
    basePath: '/supervision',
    // Slice 9: supervision lands on "Colas" (every open case, by language).
    home: '/supervision/colas',
    avatarTone: 'peach',
    nav: [
      {
        to: '/supervision/colas',
        label: 'Colas',
        icon: Inbox,
        indicator: 'queuedCases',
        // The read-only case view is reached from Colas (and the other screens).
        alsoActiveOn: ['/supervision/casos'],
      },
      { to: '/supervision/equipo', label: 'Equipo', icon: Users },
      {
        to: '/supervision/escalados',
        label: 'Escalados',
        icon: CircleArrowUp,
        indicator: 'openEscalations',
      },
      { to: '/supervision/auditoria', label: 'Auditoría', icon: Shield },
    ],
  },
  admin: {
    id: 'admin',
    label: 'Administración',
    basePath: '/administracion',
    home: '/administracion/usuarios',
    avatarTone: 'success',
    nav: [
      {
        to: '/administracion/usuarios',
        label: 'Usuarios y roles',
        icon: UserPlus,
        indicator: 'lockedAccounts',
      },
      { to: '/administracion/equipos', label: 'Equipos', icon: UsersRound },
      { to: '/administracion/auditoria', label: 'Auditoría', icon: Shield },
    ],
  },
}

/**
 * "Casos" with a filter and/or a case open (slice 6 §4.2): the Workspace URL state
 * `?caso=&estado=` (`estado` slug from `slugFromInboxStatus`, cases feature).
 */
export function workspacePath({
  caseId,
  filterSlug,
}: { caseId?: string | null; filterSlug?: string | null } = {}): string {
  const params = new URLSearchParams()
  if (caseId) params.set('caso', caseId)
  if (filterSlug) params.set('estado', filterSlug)
  const search = params.toString()
  return search ? `/analista?${search}` : '/analista'
}

/** Supervisor read-only view of one case (slice 3 §8.1). */
export function supervisionCasePath(caseId: string): string {
  return `/supervision/casos/${caseId}`
}

/** "Equipo" with one analyst's sheet open (slice 3 §8.9). */
export function supervisionAnalystPath(staffId: string): string {
  return `/supervision/equipo?${new URLSearchParams({ analista: staffId }).toString()}`
}

/** "Escalados" with one escalation open in the side panel (slice 9). */
export function supervisionEscalationPath(escalationId?: string | null): string {
  return escalationId
    ? `/supervision/escalados?${new URLSearchParams({ escalamiento: escalationId }).toString()}`
    : '/supervision/escalados'
}

/** "Colas" of one language (slice 9: Spanish is the default, so it carries no param). */
export function supervisionQueuesPath(language: 'es' | 'pt'): string {
  return language === 'es' ? '/supervision/colas' : '/supervision/colas?idioma=pt'
}

/** "Usuarios y roles" with one person selected (slice 4 §10.1). */
export function adminUserPath(staffId: string): string {
  return `/administracion/usuarios?${new URLSearchParams({ persona: staffId }).toString()}`
}

/** "Equipos" with one team selected (slice 4 §10.1). */
export function adminTeamPath(teamId: string): string {
  return `/administracion/equipos?${new URLSearchParams({ equipo: teamId }).toString()}`
}

/** The admin audit entry searching an id: what she did and what was done to her (slice 4 §7.2). */
export function adminAuditPath(q: string): string {
  return `/administracion/auditoria?${new URLSearchParams({ q }).toString()}`
}

/** Display order in the role switcher and priority for "first role home". */
export const ROLE_ORDER: readonly RoleId[] = ['analyst', 'supervisor', 'admin']

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** Role that owns a pathname, or null for shared pages (404). */
export function roleFromPath(pathname: string): RoleId | null {
  return ROLE_ORDER.find((id) => matchesPrefix(pathname, ROLES[id].basePath)) ?? null
}

/** The user's roles in canonical order (unknown values dropped). */
export function sortRoles(roles: readonly string[]): RoleId[] {
  return ROLE_ORDER.filter((id) => roles.includes(id))
}

/**
 * Role names in sentences, chips and toasts ("Analista", not the switcher's
 * "Analista de casos"). Pinned by a test to the backend `copy.ROLE_LABEL`.
 */
export const ROLE_LABEL: Record<RoleId, string> = {
  analyst: 'Analista',
  supervisor: 'Supervisión',
  admin: 'Administración',
}

/** "Analista y Supervisión": the user's roles in canonical order. */
export function rolesLabel(roles: readonly string[]): string {
  return joinEs(sortRoles(roles).map((role) => ROLE_LABEL[role]))
}

/** Description of the "Cambiaron tus roles" toast (app/session-live.tsx, slice 4 §10.7). */
export function rolesNowCopy(roles: readonly string[]): string {
  return `Ahora tienes: ${rolesLabel(roles)}.`
}

/** Landing page after login: the home of the first role the user holds. */
export function firstRoleHome(roles: readonly string[]): string | null {
  const first = sortRoles(roles)[0]
  return first ? ROLES[first].home : null
}

/** Whether a rail item is the current page for `pathname`. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to
  if (matchesPrefix(pathname, item.to)) return true
  return item.alsoActiveOn?.some((prefix) => matchesPrefix(pathname, prefix)) ?? false
}

/**
 * Where to go after login: the page the user asked for (if their roles allow
 * it), otherwise their first role home.
 */
export function resolvePostLoginPath(
  roles: readonly string[],
  requested?: string | null,
): string | null {
  const home = firstRoleHome(roles)
  if (!home) return null
  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) return home
  const owner = roleFromPath(requested.split(/[?#]/)[0] ?? requested)
  return owner && sortRoles(roles).includes(owner) ? requested : home
}
