import type { AnalystHome, HomeActivityItem } from '@/features/home'
import { NOW, minutesFrom } from './case-fixtures'
import { TEAM_ANDES } from './fixtures'

/**
 * Invented "Inicio" data for tests ("Datos de ejemplo"): the slice 6 activity
 * rows of HomeTurno.dc.html, never dataset records.
 */
export function makeActivityItem(overrides: Partial<HomeActivityItem> = {}): HomeActivityItem {
  return {
    kind: 'assigned_on_arrival',
    caseId: 'CASE-00000000000000000000000103',
    customerName: 'Larissa Monteiro Alves',
    occurredAt: minutesFrom(-14),
    language: 'es',
    readOnly: false,
    caseStatus: 'assigned',
    inboxStatus: 'new',
    slaDueAt: minutesFrom(1),
    firstResponseAt: null,
    actorName: null,
    targetName: null,
    reason: 'language_least_loaded',
    waitedSeconds: null,
    previousCasesCount: null,
    lastCloseReason: null,
    messageCount: null,
    ...overrides,
  }
}

/** The canvas feed: messages, reassigned away, arrival in Portuguese, a customer who came back. */
export const canvasFeed: HomeActivityItem[] = [
  makeActivityItem({
    kind: 'customer_messages',
    caseId: 'CASE-00000000000000000000000102',
    customerName: 'Beatriz Salcedo Prieto',
    occurredAt: minutesFrom(-2),
    caseStatus: 'in_progress',
    inboxStatus: 'to_reply',
    reason: null,
    messageCount: 2,
  }),
  makeActivityItem({
    kind: 'reassigned_away',
    caseId: 'CASE-00000000000000000000000101',
    customerName: 'Marcela Quintana Pardo',
    occurredAt: minutesFrom(-6),
    readOnly: true,
    caseStatus: 'in_progress',
    inboxStatus: 'to_reply',
    actorName: 'Lucía Herrera',
    targetName: 'Sebastián Cárdenas',
    reason: 'manual',
  }),
  makeActivityItem({ language: 'pt' }),
  makeActivityItem({
    kind: 'customer_returned',
    caseId: 'CASE-00000000000000000000000108',
    customerName: 'Patricia Lozano Vega',
    occurredAt: minutesFrom(-15),
    reason: null,
    previousCasesCount: 2,
    lastCloseReason: 'resolved',
  }),
  makeActivityItem({
    kind: 'assigned_from_queue',
    caseId: 'CASE-00000000000000000000000111',
    customerName: 'Rosa Elena Ibarra Méndez',
    occurredAt: minutesFrom(-20),
    reason: 'queue_drained',
    waitedSeconds: 17 * 60 + 20,
  }),
]

export function makeHome(overrides: Partial<AnalystHome> = {}): AnalystHome {
  return {
    since: minutesFrom(-40),
    sinceSource: 'previous_session',
    activity: { items: canvasFeed, total: canvasFeed.length },
    teamNow: {
      teamId: TEAM_ANDES.id,
      teamName: TEAM_ANDES.name,
      availableCount: 0,
      analystCount: 4,
      queues: [
        { language: 'es', waiting: 2, oldestQueuedAt: minutesFrom(-17) },
        { language: 'pt', waiting: 1, oldestQueuedAt: minutesFrom(-6) },
      ],
    },
    serverTime: NOW.toISOString(),
    ...overrides,
  }
}
