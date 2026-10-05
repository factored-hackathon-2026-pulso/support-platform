import {
  CircleArrowUp,
  House,
  Inbox,
  MessageSquare,
  Shield,
  SlidersHorizontal,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import type { AvatarTone } from '@/components/ui'
import { joinEs } from '@/lib/format'
import { PATHS } from './paths'

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
    basePath: PATHS.analyst.root,
    // Slice 6: the analyst lands on "Inicio"; "Casos" is the Workspace.
    home: PATHS.analyst.home,
    avatarTone: 'accent',
    nav: [
      { to: PATHS.analyst.home, label: 'Inicio', icon: House },
      { to: PATHS.analyst.cases, label: 'Casos', icon: MessageSquare, indicator: 'toReplyCases' },
    ],
  },
  supervisor: {
    id: 'supervisor',
    // Gender-neutral (slice 9): the role, not a person ("Supervisión", never "Supervisora").
    label: 'Supervisión',
    basePath: PATHS.supervision.root,
    // Slice 9: supervision lands on "Colas" (every open case, by language).
    home: PATHS.supervision.queues,
    avatarTone: 'peach',
    nav: [
      {
        to: PATHS.supervision.queues,
        label: 'Colas',
        icon: Inbox,
        indicator: 'queuedCases',
        // The read-only case view is reached from Colas (and the other screens).
        alsoActiveOn: [PATHS.supervision.cases],
      },
      { to: PATHS.supervision.team, label: 'Equipo', icon: Users },
      {
        to: PATHS.supervision.escalations,
        label: 'Escalados',
        icon: CircleArrowUp,
        indicator: 'openEscalations',
      },
      { to: PATHS.supervision.audit, label: 'Auditoría', icon: Shield },
    ],
  },
  admin: {
    id: 'admin',
    label: 'Administración',
    basePath: PATHS.admin.root,
    home: PATHS.admin.users,
    avatarTone: 'success',
    nav: [
      {
        to: PATHS.admin.users,
        label: 'Usuarios y roles',
        icon: UserPlus,
        indicator: 'lockedAccounts',
      },
      { to: PATHS.admin.teams, label: 'Equipos', icon: UsersRound },
      { to: PATHS.admin.audit, label: 'Auditoría', icon: Shield },
      // Slice 18: platform-wide settings (the AI switch). Always there: it is how AI turns on.
      { to: PATHS.admin.platform, label: 'Plataforma', icon: SlidersHorizontal },
    ],
  },
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
