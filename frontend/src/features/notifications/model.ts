/**
 * Notification center rules and copy (docs/platform/api/slice-10-notifications.md §5):
 * pure, no React, unit-tested.
 *
 * The API sends structured facts only (`kind` + who + which case); every word lives here, in
 * fixed templates (people-only, no AI, gender-neutral roles: "Supervisión"). One map,
 * `NOTIFICATION_KIND`, gives each kind its icon tile, tone and primary action; the canvas
 * boards (Workspace "notificaciones", SuColas / Admin `notificaciones`, HomeTurno) are the
 * source of the copy.
 */
import {
  adminUserPath,
  PATHS,
  supervisionCasePath,
  supervisionEscalationPath,
  supervisionQueuesPath,
  workspacePath,
} from '@/app/paths'
import type { RoleId } from '@/app/roles'
import { ratingOption } from '@/features/cases/core'
import { LANGUAGE_NAMES } from '@/features/conversation/core'
import { formatDate } from '@/lib/format'
import type {
  Notification,
  NotificationCreatedPayload,
  NotificationKind,
  NotificationPage,
  NotificationPages,
  NotificationsReadPayload,
} from './types'

/** Icon of a kind's tile (drawn by `NotificationTile`). */
export type NotificationIcon =
  'inbox' | 'reply' | 'move' | 'back' | 'smile' | 'up' | 'clock' | 'flame' | 'lock' | 'user-check'

/** Tile colors (canvas: blue, green, orange, red). */
export type NotificationTone = 'accent' | 'success' | 'warn' | 'danger'

export interface NotificationAppearance {
  icon: NotificationIcon
  tone: NotificationTone
  /** The primary action ("Abrir caso", "Revisar", "Ver en la cola", "Ver usuarios"). */
  action: string
}

/** The one map of kinds: tile and primary action. */
export const NOTIFICATION_KIND: Record<NotificationKind, NotificationAppearance> = {
  assigned_on_arrival: { icon: 'inbox', tone: 'accent', action: 'Abrir caso' },
  assigned_from_queue: { icon: 'inbox', tone: 'accent', action: 'Abrir caso' },
  assigned_by_supervisor: { icon: 'inbox', tone: 'accent', action: 'Abrir caso' },
  reassigned_away: { icon: 'move', tone: 'warn', action: 'Ver caso' },
  customer_returned: { icon: 'back', tone: 'accent', action: 'Abrir caso' },
  escalation_answered: { icon: 'reply', tone: 'success', action: 'Revisar' },
  escalation_taken: { icon: 'move', tone: 'warn', action: 'Ver caso' },
  escalation_reassigned: { icon: 'move', tone: 'warn', action: 'Ver caso' },
  case_rated: { icon: 'smile', tone: 'success', action: 'Ver caso' },
  case_escalated: { icon: 'up', tone: 'accent', action: 'Revisar' },
  case_queued: { icon: 'clock', tone: 'warn', action: 'Ver en la cola' },
  sla_at_risk: { icon: 'flame', tone: 'danger', action: 'Ver en la cola' },
  account_locked: { icon: 'lock', tone: 'danger', action: 'Revisar' },
  invitation_accepted: { icon: 'user-check', tone: 'success', action: 'Ver usuarios' },
}

/** What one notification says and where its action goes. */
export interface NotificationCopy extends NotificationAppearance {
  title: string
  /** One line (a name, or a name and a short fact; never " · " joined). */
  detail: string
  href: string
}

const SOMEONE = 'Alguien del equipo'
const A_CUSTOMER = 'Un cliente'

function customerOf(n: Notification): string {
  return n.customerName ?? A_CUSTOMER
}

function caseHref(n: Notification): string {
  return workspacePath({ caseId: n.caseId })
}

/** "Beatriz Salcedo Prieto, vence en 1 min" / "…, vencido" / "…, ya tiene respuesta". */
export function slaRiskDetail(n: Notification, now: number): string {
  const name = customerOf(n)
  if (n.firstResponseAt) return `${name}, ya tiene respuesta`
  if (!n.slaDueAt) return name
  const minutes = Math.ceil((new Date(n.slaDueAt).getTime() - now) / 60_000)
  if (minutes <= 0) return `${name}, vencido`
  return `${name}, vence en ${minutes} min`
}

/** The fixed template of each kind (`now` only matters for the SLA countdown). */
export function notificationCopy(n: Notification, now: number): NotificationCopy {
  const appearance = NOTIFICATION_KIND[n.kind]
  const customer = customerOf(n)
  const actor = n.actorName ?? SOMEONE
  const target = n.targetName ?? SOMEONE
  const language = n.language ?? 'es'
  const copy = (title: string, detail: string, href: string): NotificationCopy => ({
    ...appearance,
    title,
    detail,
    href,
  })
  switch (n.kind) {
    case 'assigned_on_arrival':
    case 'assigned_from_queue':
      return copy('Te llegó un caso nuevo', customer, caseHref(n))
    case 'assigned_by_supervisor':
      return copy('Supervisión te asignó un caso', customer, caseHref(n))
    case 'reassigned_away':
      return copy('Supervisión reasignó tu caso', `${customer} pasó a ${target}`, caseHref(n))
    case 'customer_returned':
      return copy('El cliente volvió a escribir', customer, caseHref(n))
    case 'escalation_answered':
      return copy(
        'Supervisión respondió tu escalamiento',
        `${actor} sobre ${customer}`,
        caseHref(n),
      )
    case 'escalation_taken':
      return copy('Supervisión tomó tu caso', `${customer} pasó a ${actor}`, caseHref(n))
    case 'escalation_reassigned':
      return copy(
        'Supervisión reasignó tu caso escalado',
        `${customer} pasó a ${target}`,
        caseHref(n),
      )
    case 'case_rated':
      return copy(
        `El cliente calificó tu atención: ${ratingOption(n.score ?? 1).label}`,
        customer,
        workspacePath({ caseId: n.caseId, status: 'closed' }),
      )
    case 'case_escalated':
      return copy(`${actor} escaló un caso`, customer, supervisionEscalationPath(n.escalationId))
    case 'case_queued':
      return copy(
        `Un caso espera en la cola en ${LANGUAGE_NAMES[language]}`,
        customer,
        supervisionQueuesPath(language),
      )
    case 'sla_at_risk':
      return copy(
        'Caso por vencer sin respuesta',
        slaRiskDetail(n, now),
        supervisionQueuesPath(language),
      )
    case 'account_locked':
      return copy(
        `Cuenta bloqueada: ${target}`,
        `${n.failedAttempts ?? 5} intentos fallidos al entrar`,
        n.targetId ? adminUserPath(n.targetId) : PATHS.admin.users,
      )
    case 'invitation_accepted':
      return copy(
        `Invitación aceptada: ${target}`,
        'Ya puede entrar a la plataforma',
        n.targetId ? adminUserPath(n.targetId) : PATHS.admin.users,
      )
  }
}

/** "ahora", "hace 6 min", "hace 2 h"; from a day on, the date ("1 oct"). */
export function notificationTime(createdAt: string, now: number): string {
  const minutes = Math.floor((now - new Date(createdAt).getTime()) / 60_000)
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return formatDate(createdAt, { withYear: false })
}

/** Accessible name of the bell: "Notificaciones, 3 sin leer" (count also on the badge). */
export function bellLabel(unread: number): string {
  return unread > 0 ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'
}

export interface NotificationSection {
  title: 'Nuevas' | 'Anteriores'
  items: Notification[]
}

/** "Nuevas" (unread) then "Anteriores" (read), each newest first; empty ones left out. */
export function notificationSections(items: readonly Notification[]): NotificationSection[] {
  const fresh = items.filter((n) => !n.readAt)
  const seen = items.filter((n) => n.readAt)
  const sections: NotificationSection[] = []
  if (fresh.length) sections.push({ title: 'Nuevas', items: fresh })
  if (seen.length) sections.push({ title: 'Anteriores', items: seen })
  return sections
}

// ── toasts ────────────────────────────────────────────────────────────────────

/**
 * Router state of a navigation from a notification (the bell or a toast): the destination
 * moves the focus to what it opened, since the control that had it is gone (Casos: the
 * case heading).
 */
export const NOTIFICATION_NAVIGATION = { focus: 'notification' } as const

export interface ScreenLocation {
  pathname: string
  search: string
}

/**
 * Analyst kinds the open case shows by itself (the new case, the answer card, the rating in
 * the footer). A case that leaves her (reassigned, taken) is not one of them: the screen
 * turns read-only under her, so the toast says why.
 */
const SHOWN_IN_THE_CASE: ReadonlySet<NotificationKind> = new Set([
  'assigned_on_arrival',
  'assigned_from_queue',
  'assigned_by_supervisor',
  'customer_returned',
  'escalation_answered',
  'case_rated',
])

/**
 * Whether the screen already shows what the notification is about: its case open in Casos
 * (for the kinds the case shows by itself) or in the supervisor's case view, "Escalados" for
 * a new escalation (the row arrives live there), the locked or invited person selected in
 * "Usuarios y roles".
 */
export function isOnScreen(n: Notification, { pathname, search }: ScreenLocation): boolean {
  const params = new URLSearchParams(search)
  if (n.role === 'analyst') {
    return (
      SHOWN_IN_THE_CASE.has(n.kind) &&
      pathname === PATHS.analyst.cases &&
      n.caseId !== null &&
      params.get('case') === n.caseId
    )
  }
  if (n.role === 'supervisor') {
    if (n.kind === 'case_escalated' && pathname === PATHS.supervision.escalations) return true
    return n.caseId !== null && pathname === supervisionCasePath(n.caseId)
  }
  return pathname === PATHS.admin.users && params.get('person') === n.targetId
}

/**
 * A live notification toasts only on the screens of its role (an Analista + Supervisión
 * working cases does not get supervision toasts there; the bell has them all) and only
 * when the screen is not already showing it.
 */
export function shouldToast(
  n: Notification,
  role: RoleId | null,
  location: ScreenLocation,
): boolean {
  return n.role === role && !n.readAt && !isOnScreen(n, location)
}

// ── cache ─────────────────────────────────────────────────────────────────────

/** Every loaded notification, newest first (a row moved between pages appears once). */
export function allNotifications(pages: NotificationPages | undefined): Notification[] {
  if (!pages) return []
  const seen = new Set<string>()
  const items: Notification[] = []
  for (const page of pages.pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
  }
  return items
}

/** Her unread count (the first page carries the latest). */
export function unreadCountOf(pages: NotificationPages | undefined): number {
  return pages?.pages[0]?.unreadCount ?? 0
}

/** The same pages with the server's unread count. */
export function withUnreadCount(pages: NotificationPages, unreadCount: number): NotificationPages {
  return {
    ...pages,
    pages: pages.pages.map((page): NotificationPage => ({ ...page, unreadCount })),
  }
}

/** `notification.created`: prepend it (once) and take the server's unread count. */
export function withCreated(
  pages: NotificationPages,
  { notification, unreadCount }: NotificationCreatedPayload,
): NotificationPages {
  const known = allNotifications(pages).some((n) => n.id === notification.id)
  const next = withUnreadCount(pages, unreadCount)
  if (known) return next
  const [first, ...rest] = next.pages
  if (!first) return next
  const items = [notification, ...first.items].sort(byNewest)
  return { ...next, pages: [{ ...first, items }, ...rest] }
}

/** `notifications.read` (or a read the viewer made): mark them read, take the count. */
export function withRead(
  pages: NotificationPages,
  { notificationIds, unreadCount }: NotificationsReadPayload,
  readAt: string,
): NotificationPages {
  const ids = notificationIds ? new Set(notificationIds) : null
  const next = withUnreadCount(pages, unreadCount)
  return {
    ...next,
    pages: next.pages.map((page) => ({
      ...page,
      items: page.items.map((n) =>
        !n.readAt && (ids === null || ids.has(n.id)) ? { ...n, readAt } : n,
      ),
    })),
  }
}

/** A notification as the server answered it (after a read). */
export function withNotification(
  pages: NotificationPages,
  notification: Notification,
  unreadCount: number,
): NotificationPages {
  const next = withUnreadCount(pages, unreadCount)
  return {
    ...next,
    pages: next.pages.map((page) => ({
      ...page,
      items: page.items.map((n) => (n.id === notification.id ? notification : n)),
    })),
  }
}

function byNewest(a: Notification, b: Notification): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

// ── envelopes ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The one reader of `notification.created` payloads (null when malformed). */
export function readNotificationCreated(payload: unknown): NotificationCreatedPayload | null {
  if (!isRecord(payload) || typeof payload.unreadCount !== 'number') return null
  const n = payload.notification
  if (
    !isRecord(n) ||
    typeof n.id !== 'string' ||
    typeof n.kind !== 'string' ||
    !(n.kind in NOTIFICATION_KIND) ||
    typeof n.createdAt !== 'string' ||
    typeof n.role !== 'string'
  ) {
    return null
  }
  return { notification: n as unknown as Notification, unreadCount: payload.unreadCount }
}

/** The one reader of `notifications.read` payloads (null when malformed). */
export function readNotificationsRead(payload: unknown): NotificationsReadPayload | null {
  if (!isRecord(payload) || typeof payload.unreadCount !== 'number') return null
  const ids = payload.notificationIds
  if (ids !== null && !(Array.isArray(ids) && ids.every((id) => typeof id === 'string'))) {
    return null
  }
  return { notificationIds: ids, unreadCount: payload.unreadCount }
}
