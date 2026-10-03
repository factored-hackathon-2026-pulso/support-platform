import { MessageSquare, Shield, UserPlus, Users, type LucideIcon } from 'lucide-react'
import type { AvatarTone } from '@/components/ui'

/** Same values as the API `StaffRole` enum. */
export type RoleId = 'analyst' | 'supervisor' | 'admin'

/**
 * Live signals a rail destination can show. Each key is fed by the feature that
 * owns the data (app/rail-indicators.ts); a key nobody feeds shows nothing.
 */
export type RailIndicatorKey =
  /** Cases waiting in a language queue (slice 3 feeds it; nobody does yet). */
  'queuedCases'

/** Value of one indicator: a count (orange badge) and/or a dot (something new). */
export interface RailIndicator {
  count?: number
  dot?: boolean
}

export type RailIndicators = Partial<Record<RailIndicatorKey, RailIndicator>>

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
    home: '/analista',
    avatarTone: 'accent',
    nav: [{ to: '/analista', label: 'Casos', icon: MessageSquare }],
  },
  supervisor: {
    id: 'supervisor',
    label: 'Supervisora',
    basePath: '/supervision',
    home: '/supervision/equipo',
    avatarTone: 'peach',
    nav: [
      { to: '/supervision/equipo', label: 'Equipo y colas', icon: Users },
      { to: '/supervision/auditoria', label: 'Auditoría', icon: Shield },
    ],
  },
  admin: {
    id: 'admin',
    label: 'Administración',
    basePath: '/administracion',
    home: '/administracion/usuarios',
    avatarTone: 'success',
    nav: [{ to: '/administracion/usuarios', label: 'Usuarios y roles', icon: UserPlus }],
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
