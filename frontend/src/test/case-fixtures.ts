import type { Availability, CaseSummary, InboxCounts, InboxResponse } from '@/features/cases'

/**
 * Invented cases for tests ("Datos de ejemplo"): names and ids follow the seed
 * stories of the slice 1 contract §6, never dataset records.
 */

/** Fixed "now" for SLA and relative-time assertions. */
export const NOW = new Date('2026-03-05T16:00:00Z')

const minutesFrom = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()

export function makeCaseSummary(overrides: Partial<CaseSummary> = {}): CaseSummary {
  return {
    id: 'CASE-00000000000000000000000101',
    version: 3,
    customer: { id: 'CUS-00000000000000000000001001', displayName: 'Marcela Quintana Pardo' },
    channel: 'web_chat',
    language: 'es',
    origin: 'customer',
    topic: 'disputar_cargo',
    priority: 'medium',
    status: 'in_progress',
    inboxStatus: 'to_reply',
    openedAt: minutesFrom(-14),
    slaDueAt: minutesFrom(5 * 60),
    lastInteractionAt: minutesFrom(-2),
    liveSince: null,
    preview: 'si, bloqueela porfa',
    previewAuthorRole: 'customer',
    assignedAnalystId: 'STF-ANA0000001',
    unreadCount: 0,
    lastSequence: 6,
    closedAt: null,
    ...overrides,
  }
}

/** Daniela's seeded inbox: one case per canvas status (contract §6.1). */
export const seededInbox: CaseSummary[] = [
  makeCaseSummary(),
  makeCaseSummary({
    id: 'CASE-00000000000000000000000102',
    customer: { id: 'CUS-00000000000000000000001002', displayName: 'Beatriz Salcedo Prieto' },
    channel: 'app_chat',
    slaDueAt: minutesFrom(9),
    lastInteractionAt: minutesFrom(-1),
    preview: 'contesten!! qué mal servicio',
    unreadCount: 3,
  }),
  makeCaseSummary({
    id: 'CASE-00000000000000000000000105',
    customer: { id: 'CUS-00000000000000000000001005', displayName: 'Claudia Restrepo Varela' },
    channel: 'phone',
    status: 'in_call',
    inboxStatus: 'live',
    liveSince: new Date(NOW.getTime() - 246_000).toISOString(),
    slaDueAt: minutesFrom(60),
    preview: 'Sí, claro, bloquéela.',
  }),
  makeCaseSummary({
    id: 'CASE-00000000000000000000000103',
    customer: { id: 'CUS-00000000000000000000001003', displayName: 'Larissa Monteiro Alves' },
    language: 'pt',
    topic: 'consultar_cargo',
    status: 'assigned',
    inboxStatus: 'new',
    slaDueAt: minutesFrom(58),
    preview: 'Oi, cobraram uma coisa que não corresponde',
  }),
  makeCaseSummary({
    id: 'CASE-00000000000000000000000106',
    customer: { id: 'CUS-00000000000000000000001006', displayName: 'Héctor Villarreal Garza' },
    channel: 'phone',
    origin: 'regulator',
    priority: 'low',
    status: 'to_call',
    inboxStatus: 'to_call',
    slaDueAt: minutesFrom(2 * 24 * 60 + 30),
    lastInteractionAt: minutesFrom(-2 * 24 * 60),
    preview: null,
  }),
  makeCaseSummary({
    id: 'CASE-00000000000000000000000107',
    customer: { id: 'CUS-00000000000000000000001007', displayName: 'Joaquín Ferreyra Paz' },
    channel: 'app_chat',
    topic: 'estado_disputa',
    status: 'in_progress',
    inboxStatus: 'waiting',
    slaDueAt: minutesFrom(3 * 60),
    lastInteractionAt: minutesFrom(-25),
    preview: 'Hola, Joaquín. Soy Daniela, de LATAM Bank.',
    previewAuthorRole: 'analyst',
  }),
]

export function makeCounts(overrides: Partial<InboxCounts> = {}): InboxCounts {
  return {
    all: 6,
    new: 1,
    toReply: 2,
    live: 1,
    toCall: 1,
    waiting: 1,
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
  live: 0,
  toCall: 0,
  waiting: 0,
})

export const available: Availability = { status: 'available', since: NOW.toISOString() }
export const paused: Availability = { status: 'paused', since: NOW.toISOString() }
