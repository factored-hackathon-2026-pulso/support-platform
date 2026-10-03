import type { Availability, CaseSummary, InboxCounts, InboxResponse } from '@/features/cases'

/**
 * Invented cases for tests ("Datos de ejemplo"): names and ids follow the seed
 * stories of the slice 2 contract §8.3, never dataset records.
 */

/** Fixed "now" for SLA and relative-time assertions. */
export const NOW = new Date('2026-03-05T16:00:00Z')

export const minutesFrom = (minutes: number) =>
  new Date(NOW.getTime() + minutes * 60_000).toISOString()

export function makeCaseSummary(overrides: Partial<CaseSummary> = {}): CaseSummary {
  return {
    id: 'CASE-00000000000000000000000101',
    version: 3,
    customer: { id: 'CUS-00000000000000000000001001', displayName: 'Marcela Quintana Pardo' },
    channel: 'web_chat',
    language: 'es',
    priority: 'medium',
    status: 'in_progress',
    inboxStatus: 'to_reply',
    openedAt: minutesFrom(-14),
    slaDueAt: minutesFrom(1),
    firstResponseAt: minutesFrom(-10),
    lastInteractionAt: minutesFrom(-2),
    preview: 'es un retiro en cajero del 9 de enero por $1.585.208, yo no lo hice',
    previewAuthorRole: 'customer',
    assignedAnalystId: 'STF-ANA0000001',
    unreadCount: 1,
    lastSequence: 5,
    previousCaseId: null,
    closedAt: null,
    closeReason: null,
    ...overrides,
  }
}

/** Daniela's open cases (contract §8.3): Por responder 2 · Nuevos 2 · Esperando 1. */
export const seededInbox: CaseSummary[] = [
  makeCaseSummary({
    id: 'CASE-00000000000000000000000102',
    customer: { id: 'CUS-00000000000000000000001002', displayName: 'Beatriz Salcedo Prieto' },
    channel: 'app_chat',
    openedAt: minutesFrom(-12),
    slaDueAt: minutesFrom(3),
    firstResponseAt: null,
    lastInteractionAt: minutesFrom(-1),
    preview: 'contesten!! qué mal servicio',
    unreadCount: 3,
    lastSequence: 6,
  }),
  makeCaseSummary(),
  makeCaseSummary({
    id: 'CASE-00000000000000000000000103',
    customer: { id: 'CUS-00000000000000000000001003', displayName: 'Larissa Monteiro Alves' },
    language: 'pt',
    status: 'assigned',
    inboxStatus: 'new',
    openedAt: minutesFrom(-2),
    slaDueAt: minutesFrom(13),
    firstResponseAt: null,
    lastInteractionAt: minutesFrom(-2),
    preview: 'Oi, cobraram uma coisa que não corresponde, já estou no limite com isso!',
    unreadCount: 1,
    lastSequence: 3,
  }),
  makeCaseSummary({
    id: 'CASE-00000000000000000000000108',
    customer: { id: 'CUS-00000000000000000000001004', displayName: 'Patricia Lozano Vega' },
    channel: 'app_chat',
    status: 'assigned',
    inboxStatus: 'new',
    openedAt: minutesFrom(-4),
    slaDueAt: minutesFrom(11),
    firstResponseAt: null,
    lastInteractionAt: minutesFrom(-4),
    preview: 'Hola, otra vez yo. El reembolso que me dijeron todavía no aparece en mi cuenta.',
    unreadCount: 1,
    lastSequence: 4,
    previousCaseId: 'CASE-00000000000000000000000104',
  }),
  makeCaseSummary({
    id: 'CASE-00000000000000000000000107',
    customer: { id: 'CUS-00000000000000000000001007', displayName: 'Joaquín Ferreyra Paz' },
    channel: 'app_chat',
    openedAt: minutesFrom(-50),
    slaDueAt: minutesFrom(-35),
    firstResponseAt: minutesFrom(-40),
    inboxStatus: 'waiting',
    lastInteractionAt: minutesFrom(-40),
    preview: 'Hola, Joaquín. Soy Daniela, de LATAM Bank.',
    previewAuthorRole: 'analyst',
    unreadCount: 0,
    lastSequence: 4,
  }),
]

/** Daniela's Cerrados (contract §8.3), newest close first. */
export const closedInbox: CaseSummary[] = [
  makeCaseSummary({
    id: 'CASE-00000000000000000000000106',
    customer: { id: 'CUS-00000000000000000000001006', displayName: 'Héctor Villarreal Garza' },
    channel: 'app_chat',
    priority: 'low',
    status: 'closed',
    inboxStatus: 'closed',
    openedAt: minutesFrom(-4 * 60),
    firstResponseAt: minutesFrom(-3 * 60 - 50),
    lastInteractionAt: minutesFrom(-3 * 60 - 10),
    closedAt: minutesFrom(-3 * 60),
    closeReason: 'out_of_scope',
    preview: 'Ah ok, gracias',
    unreadCount: 0,
  }),
  makeCaseSummary({
    id: 'CASE-00000000000000000000000105',
    customer: { id: 'CUS-00000000000000000000001005', displayName: 'Claudia Restrepo Varela' },
    status: 'closed',
    inboxStatus: 'closed',
    openedAt: minutesFrom(-27 * 60),
    firstResponseAt: minutesFrom(-27 * 60 + 10),
    lastInteractionAt: minutesFrom(-27 * 60 + 10),
    closedAt: minutesFrom(-24 * 60),
    closeReason: 'customer_unresponsive',
    preview: 'Hola, Claudia. Soy Daniela, de LATAM Bank. ¿Me cuenta qué cargo es y de qué fecha?',
    previewAuthorRole: 'analyst',
    unreadCount: 0,
  }),
  makeCaseSummary({
    id: 'CASE-00000000000000000000000104',
    customer: { id: 'CUS-00000000000000000000001004', displayName: 'Patricia Lozano Vega' },
    channel: 'app_chat',
    status: 'closed',
    inboxStatus: 'closed',
    openedAt: minutesFrom(-48 * 60 - 30),
    firstResponseAt: minutesFrom(-48 * 60 - 27),
    lastInteractionAt: minutesFrom(-48 * 60 - 5),
    closedAt: minutesFrom(-48 * 60),
    closeReason: 'resolved',
    preview: 'Perfecto, muchas gracias.',
    unreadCount: 0,
    previousCaseId: 'CASE-00000000000000000000000110',
  }),
]

export function makeCounts(overrides: Partial<InboxCounts> = {}): InboxCounts {
  return {
    all: 5,
    new: 2,
    toReply: 2,
    waiting: 1,
    closed: 3,
    computedAt: NOW.toISOString(),
    ...overrides,
  }
}

export function makeInbox(
  items: CaseSummary[] = seededInbox,
  counts: Partial<InboxCounts> = {},
): InboxResponse {
  return { items, counts: makeCounts(counts), serverTime: NOW.toISOString() }
}

export const emptyInbox: InboxResponse = makeInbox([], {
  all: 0,
  new: 0,
  toReply: 0,
  waiting: 0,
  closed: 0,
})

export const available: Availability = { status: 'available', since: NOW.toISOString() }
export const paused: Availability = { status: 'paused', since: NOW.toISOString() }
