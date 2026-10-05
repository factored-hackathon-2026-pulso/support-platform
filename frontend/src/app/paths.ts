/**
 * The routes module of the SPA (brief §5, ARCHITECTURE.md §4): every path the app
 * serves and the links from one screen into another. Paths and query parameters are
 * English; only the copy is Spanish. The route table (router.tsx), the rail
 * (roles.ts) and the features build their links from here: no path is written
 * anywhere else. Each screen's own query string (parse + serialize) lives in its
 * feature's `url.ts`, and a round-trip test there pins the links built here.
 */
import type { InboxStatus } from '@/features/cases/core'

export const PATHS = {
  login: '/login',
  loginVerify: '/login/verify',
  loginLocked: '/login/locked',
  /** The invitation link (`?token=`, part 4); the backend emails `{CC_PUBLIC_APP_URL}/activate`. */
  activate: '/activate',
  /** The password-reset link (`?token=`, part 4). */
  resetPassword: '/reset-password',
  /** Development mailbox (only when the backend runs it). */
  devMailbox: '/dev/mailbox',
  /** Customer simulator (dev/demo tool outside the staff shell). */
  customer: '/customer',
  analyst: {
    root: '/analyst',
    home: '/analyst/home',
    /** The Workspace ("Casos"). */
    cases: '/analyst/cases',
  },
  supervision: {
    root: '/supervision',
    queues: '/supervision/queues',
    team: '/supervision/team',
    escalations: '/supervision/escalations',
    /** Prefix of the read-only case view (`/supervision/cases/:caseId`). */
    cases: '/supervision/cases',
    audit: '/supervision/audit',
  },
  admin: {
    root: '/admin',
    users: '/admin/users',
    teams: '/admin/teams',
    audit: '/admin/audit',
    /** Slice 18: "Plataforma" (the AI switch). */
    platform: '/admin/platform',
  },
} as const

function withSearch(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString()
  return search ? `${path}?${search}` : path
}

/**
 * "Casos" with a filter and/or a case open (slice 6 §4.2): `?case=&status=` (the status
 * is the API `InboxStatus`; features/workspace/url.ts reads it).
 */
export function workspacePath({
  caseId,
  status,
}: { caseId?: string | null; status?: InboxStatus | null } = {}): string {
  return withSearch(PATHS.analyst.cases, {
    ...(caseId ? { case: caseId } : {}),
    ...(status ? { status } : {}),
  })
}

/** Supervisor read-only view of one case (slice 3 §8.1). */
export function supervisionCasePath(caseId: string): string {
  return `${PATHS.supervision.cases}/${encodeURIComponent(caseId)}`
}

/** "Equipo" with one analyst's sheet open (slice 3 §8.9). */
export function supervisionAnalystPath(staffId: string): string {
  return withSearch(PATHS.supervision.team, { analyst: staffId })
}

/** "Escalados" with one escalation open in the side panel (slice 9). */
export function supervisionEscalationPath(escalationId?: string | null): string {
  return withSearch(PATHS.supervision.escalations, escalationId ? { escalation: escalationId } : {})
}

/** "Colas" of one language (slice 9: Spanish is the default, so it carries no param). */
export function supervisionQueuesPath(language: 'es' | 'pt'): string {
  return withSearch(PATHS.supervision.queues, language === 'es' ? {} : { language })
}

/** "Usuarios y roles" with one person selected (slice 4 §10.1). */
export function adminUserPath(staffId: string): string {
  return withSearch(PATHS.admin.users, { person: staffId })
}

/** "Equipos" with one team selected (slice 4 §10.1). */
export function adminTeamPath(teamId: string): string {
  return withSearch(PATHS.admin.teams, { team: teamId })
}

/** The admin audit entry searching an id: what she did and what was done to her (slice 4 §7.2). */
export function adminAuditPath(q: string): string {
  return withSearch(PATHS.admin.audit, { q })
}
