import { describe, expect, it } from 'vitest'
import { NOW, minutesFrom } from '@/test/case-fixtures'
import {
  analystNotifications,
  asPages,
  makeNotification,
  makeNotificationPage,
} from '@/test/notification-fixtures'
import {
  NOTIFICATION_KIND,
  allNotifications,
  bellLabel,
  isOnScreen,
  notificationCopy,
  notificationSections,
  notificationTime,
  readNotificationCreated,
  readNotificationsRead,
  shouldToast,
  slaRiskDetail,
  unreadCountOf,
  withCreated,
  withNotification,
  withRead,
  withUnreadCount,
} from './model'
import type { Notification, NotificationKind } from './types'

const now = NOW.getTime()
const CASE = 'CASE-00000000000000000000000103'

function copyOf(overrides: Partial<Notification>) {
  return notificationCopy(makeNotification(overrides), now)
}

describe('notificationCopy: one fixed template per kind (canvas boards)', () => {
  it('words the analyst kinds', () => {
    expect(copyOf({ kind: 'assigned_on_arrival' })).toMatchObject({
      title: 'Te llegó un caso nuevo',
      detail: 'Larissa Monteiro Alves',
      action: 'Abrir caso',
      href: `/analyst/cases?case=${CASE}`,
      icon: 'inbox',
      tone: 'accent',
    })
    expect(copyOf({ kind: 'assigned_from_queue' }).title).toBe('Te llegó un caso nuevo')
    expect(copyOf({ kind: 'assigned_by_supervisor', actorName: 'Lucía Herrera' })).toMatchObject({
      title: 'Supervisión te asignó un caso',
      detail: 'Larissa Monteiro Alves',
    })
    expect(
      copyOf({
        kind: 'reassigned_away',
        customerName: 'Marcela Quintana',
        targetName: 'Sebastián Cárdenas',
      }),
    ).toMatchObject({
      title: 'Supervisión reasignó tu caso',
      detail: 'Marcela Quintana pasó a Sebastián Cárdenas',
      action: 'Ver caso',
      icon: 'move',
      tone: 'warn',
    })
    expect(copyOf({ kind: 'customer_returned' })).toMatchObject({
      title: 'El cliente volvió a escribir',
      icon: 'back',
      action: 'Abrir caso',
    })
    expect(
      copyOf({
        kind: 'escalation_answered',
        actorName: 'Lucía Herrera',
        customerName: 'Marcela Quintana Pardo',
      }),
    ).toMatchObject({
      title: 'Supervisión respondió tu escalamiento',
      detail: 'Lucía Herrera sobre Marcela Quintana Pardo',
      action: 'Revisar',
      icon: 'reply',
      tone: 'success',
    })
    expect(copyOf({ kind: 'escalation_taken', actorName: 'Felipe Echeverri' })).toMatchObject({
      title: 'Supervisión tomó tu caso',
      detail: 'Larissa Monteiro Alves pasó a Felipe Echeverri',
    })
    expect(copyOf({ kind: 'escalation_reassigned', targetName: 'Julián Ortega' })).toMatchObject({
      title: 'Supervisión reasignó tu caso escalado',
      detail: 'Larissa Monteiro Alves pasó a Julián Ortega',
    })
    expect(copyOf({ kind: 'case_rated', score: 4 })).toMatchObject({
      title: 'El cliente calificó tu atención: Excelente',
      href: `/analyst/cases?case=${CASE}&status=closed`,
      icon: 'smile',
    })
    expect(copyOf({ kind: 'case_rated', score: 1 }).title).toBe(
      'El cliente calificó tu atención: Mal',
    )
  })

  it('words the supervision kinds, gender-neutral', () => {
    expect(
      copyOf({
        kind: 'case_escalated',
        role: 'supervisor',
        actorName: 'Daniela Ríos',
        customerName: 'Marcela Quintana Pardo',
        escalationId: 'ESC-1',
      }),
    ).toMatchObject({
      title: 'Daniela Ríos escaló un caso',
      detail: 'Marcela Quintana Pardo',
      action: 'Revisar',
      href: '/supervision/escalations?escalation=ESC-1',
      icon: 'up',
    })
    expect(copyOf({ kind: 'case_queued', role: 'supervisor', language: 'pt' })).toMatchObject({
      title: 'Un caso espera en la cola en portugués',
      action: 'Ver en la cola',
      href: '/supervision/queues?language=pt',
      icon: 'clock',
      tone: 'warn',
    })
    expect(copyOf({ kind: 'case_queued', role: 'supervisor', language: 'es' }).href).toBe(
      '/supervision/queues',
    )
    expect(
      copyOf({ kind: 'sla_at_risk', role: 'supervisor', slaDueAt: minutesFrom(1) }),
    ).toMatchObject({
      title: 'Caso por vencer sin respuesta',
      detail: 'Larissa Monteiro Alves, vence en 1 min',
      action: 'Ver en la cola',
      icon: 'flame',
      tone: 'danger',
    })
  })

  it('words the administration kinds', () => {
    expect(
      copyOf({
        kind: 'account_locked',
        role: 'admin',
        caseId: null,
        targetId: 'STF-12',
        targetName: 'Mariana Duque',
        failedAttempts: 5,
      }),
    ).toMatchObject({
      title: 'Cuenta bloqueada: Mariana Duque',
      detail: '5 intentos fallidos al entrar',
      action: 'Revisar',
      href: '/admin/users?person=STF-12',
      icon: 'lock',
    })
    expect(
      copyOf({
        kind: 'invitation_accepted',
        role: 'admin',
        caseId: null,
        targetId: 'STF-14',
        targetName: 'Tatiana Rojas',
      }),
    ).toMatchObject({
      title: 'Invitación aceptada: Tatiana Rojas',
      detail: 'Ya puede entrar a la plataforma',
      action: 'Ver usuarios',
      icon: 'user-check',
    })
  })

  it('covers every kind and never joins facts with " · "', () => {
    const kinds = Object.keys(NOTIFICATION_KIND) as NotificationKind[]
    expect(kinds).toHaveLength(14)
    for (const kind of kinds) {
      const copy = copyOf({ kind, targetId: 'STF-1', escalationId: 'ESC-1' })
      expect(copy.title).not.toContain(' · ')
      expect(copy.detail).not.toContain(' · ')
      expect(copy.title).not.toMatch(/Supervisora|Supervisor\b/)
      expect(copy.href.startsWith('/')).toBe(true)
    }
  })

  it('falls back when a name is missing', () => {
    expect(copyOf({ kind: 'assigned_on_arrival', customerName: null }).detail).toBe('Un cliente')
    expect(copyOf({ kind: 'case_escalated', actorName: null }).title).toBe(
      'Alguien del equipo escaló un caso',
    )
  })
})

describe('slaRiskDetail', () => {
  it('counts down, then says it is overdue or answered', () => {
    const base = { kind: 'sla_at_risk' as const, customerName: 'Beatriz Salcedo Prieto' }
    expect(slaRiskDetail(makeNotification({ ...base, slaDueAt: minutesFrom(3) }), now)).toBe(
      'Beatriz Salcedo Prieto, vence en 3 min',
    )
    expect(slaRiskDetail(makeNotification({ ...base, slaDueAt: minutesFrom(-1) }), now)).toBe(
      'Beatriz Salcedo Prieto, vencido',
    )
    expect(
      slaRiskDetail(
        makeNotification({ ...base, slaDueAt: minutesFrom(3), firstResponseAt: minutesFrom(-1) }),
        now,
      ),
    ).toBe('Beatriz Salcedo Prieto, ya tiene respuesta')
    expect(slaRiskDetail(makeNotification({ ...base, slaDueAt: null }), now)).toBe(
      'Beatriz Salcedo Prieto',
    )
  })
})

describe('time, bell and sections', () => {
  it('says "ahora", minutes, hours, then the date', () => {
    expect(notificationTime(minutesFrom(0), now)).toBe('ahora')
    expect(notificationTime(minutesFrom(-6), now)).toBe('hace 6 min')
    expect(notificationTime(minutesFrom(-130), now)).toBe('hace 2 h')
    expect(notificationTime('2026-03-01T15:00:00Z', now)).toBe('1 mar')
  })

  it('names the bell with its count', () => {
    expect(bellLabel(0)).toBe('Notificaciones')
    expect(bellLabel(1)).toBe('Notificaciones, 1 sin leer')
    expect(bellLabel(3)).toBe('Notificaciones, 3 sin leer')
  })

  it('splits "Nuevas" and "Anteriores", leaving empty ones out', () => {
    const sections = notificationSections(analystNotifications)
    expect(sections.map((s) => [s.title, s.items.length])).toEqual([
      ['Nuevas', 3],
      ['Anteriores', 2],
    ])
    expect(notificationSections(analystNotifications.slice(3)).map((s) => s.title)).toEqual([
      'Anteriores',
    ])
    expect(notificationSections([])).toEqual([])
  })
})

describe('toasts', () => {
  const analyst = makeNotification({ kind: 'assigned_on_arrival' })
  const escalated = makeNotification({ kind: 'case_escalated', role: 'supervisor' })
  const locked = makeNotification({
    kind: 'account_locked',
    role: 'admin',
    caseId: null,
    targetId: 'STF-12',
  })
  const at = (pathname: string, search = '') => ({ pathname, search })

  it('toasts only on the screens of its role', () => {
    expect(shouldToast(analyst, 'analyst', at('/analyst/home'))).toBe(true)
    expect(shouldToast(analyst, 'supervisor', at('/supervision/queues'))).toBe(false)
    expect(shouldToast(escalated, 'supervisor', at('/supervision/queues'))).toBe(true)
    expect(shouldToast(escalated, 'analyst', at('/analyst/cases'))).toBe(false)
    expect(shouldToast(locked, 'admin', at('/admin/teams'))).toBe(true)
    expect(shouldToast(locked, null, at('/no-existe'))).toBe(false)
    expect(
      shouldToast({ ...analyst, readAt: minutesFrom(0) }, 'analyst', at('/analyst/cases')),
    ).toBe(false)
  })

  it('stays quiet when the screen already shows it', () => {
    expect(isOnScreen(analyst, at('/analyst/cases', `?case=${CASE}`))).toBe(true)
    expect(isOnScreen(analyst, at('/analyst/cases', '?case=CASE-OTRO'))).toBe(false)
    expect(isOnScreen(analyst, at('/analyst/home'))).toBe(false)
    // A case that leaves her still toasts: the screen turns read-only under her.
    const away = { ...analyst, kind: 'reassigned_away' as const }
    expect(isOnScreen(away, at('/analyst/cases', `?case=${CASE}`))).toBe(false)
    expect(isOnScreen(escalated, at('/supervision/escalations'))).toBe(true)
    const queued = { ...escalated, kind: 'case_queued' as const }
    expect(isOnScreen(queued, at('/supervision/escalations'))).toBe(false)
    expect(isOnScreen(queued, at(`/supervision/cases/${CASE}`))).toBe(true)
    expect(isOnScreen(locked, at('/admin/users', '?person=STF-12'))).toBe(true)
    expect(isOnScreen(locked, at('/admin/users'))).toBe(false)
  })
})

describe('the list cache', () => {
  const page = makeNotificationPage()

  it('reads the items (once) and the unread count', () => {
    const second = makeNotificationPage([analystNotifications[4]!], { unreadCount: 99 })
    const pages = asPages(page, second)
    expect(allNotifications(pages).map((n) => n.id)).toEqual(analystNotifications.map((n) => n.id))
    expect(unreadCountOf(pages)).toBe(3)
    expect(unreadCountOf(undefined)).toBe(0)
    expect(allNotifications(undefined)).toEqual([])
  })

  it('prepends a new one once, newest first, with the server count', () => {
    const fresh = makeNotification({
      id: 'NTF-00000000000000000000000099',
      createdAt: minutesFrom(0),
    })
    const next = withCreated(asPages(page), { notification: fresh, unreadCount: 4 })
    expect(allNotifications(next)[0]?.id).toBe(fresh.id)
    expect(unreadCountOf(next)).toBe(4)
    const again = withCreated(next, { notification: fresh, unreadCount: 4 })
    expect(allNotifications(again)).toHaveLength(6)
    // An older fact (the SLA sweep) lands in its place, not on top.
    const older = makeNotification({
      id: 'NTF-00000000000000000000000098',
      createdAt: minutesFrom(-20),
    })
    const placed = allNotifications(
      withCreated(asPages(page), { notification: older, unreadCount: 4 }),
    )
    expect(placed.findIndex((n) => n.id === older.id)).toBe(3)
  })

  it('marks some or all read and takes the count', () => {
    const one = withRead(
      asPages(page),
      { notificationIds: ['NTF-00000000000000000000000004'], unreadCount: 2 },
      minutesFrom(0),
    )
    expect(allNotifications(one).filter((n) => !n.readAt)).toHaveLength(2)
    expect(unreadCountOf(one)).toBe(2)
    const all = withRead(asPages(page), { notificationIds: null, unreadCount: 0 }, minutesFrom(0))
    expect(allNotifications(all).every((n) => n.readAt)).toBe(true)
    // An already read one keeps its time.
    expect(allNotifications(all)[3]?.readAt).toBe(analystNotifications[3]?.readAt)
    expect(unreadCountOf(withUnreadCount(asPages(page), 7))).toBe(7)
  })

  it('takes the server notification after a read', () => {
    const read = { ...analystNotifications[0]!, readAt: minutesFrom(0) }
    const next = withNotification(asPages(page), read, 2)
    expect(allNotifications(next)[0]).toEqual(read)
    expect(unreadCountOf(next)).toBe(2)
  })
})

describe('envelope readers', () => {
  it('reads notification.created and refuses anything else', () => {
    const notification = makeNotification()
    expect(readNotificationCreated({ notification, unreadCount: 2 })).toEqual({
      notification,
      unreadCount: 2,
    })
    expect(readNotificationCreated({ notification })).toBeNull()
    expect(
      readNotificationCreated({ notification: { ...notification, kind: 'x' }, unreadCount: 1 }),
    ).toBeNull()
    expect(readNotificationCreated(null)).toBeNull()
  })

  it('reads notifications.read', () => {
    expect(readNotificationsRead({ notificationIds: null, unreadCount: 0 })).toEqual({
      notificationIds: null,
      unreadCount: 0,
    })
    expect(readNotificationsRead({ notificationIds: ['a'], unreadCount: 1 })).toEqual({
      notificationIds: ['a'],
      unreadCount: 1,
    })
    expect(readNotificationsRead({ notificationIds: [1], unreadCount: 1 })).toBeNull()
    expect(readNotificationsRead({ unreadCount: 1 })).toBeNull()
  })
})
