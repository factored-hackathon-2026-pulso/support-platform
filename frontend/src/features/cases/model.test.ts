import { describe, expect, it } from 'vitest'
import { NOW, makeCaseSummary, makeCounts, makeInbox } from '@/test/case-fixtures'
import {
  CLOSE_REASONS,
  INBOX_FILTERS,
  RETURNED_TAG,
  SLA_AT_RISK_MS,
  assignedToastCopy,
  unassignedToastCopy,
  caseCardLine,
  changesInboxPlacement,
  channelLabel,
  channelPhrase,
  closeReasonLabel,
  countForFilter,
  countryName,
  emptyListCopy,
  fitsInboxFilter,
  formatClosedAgo,
  formatLastInteraction,
  formatSla,
  inboxStatusFromSlug,
  inboxStatusMeta,
  isNewerCase,
  isNewerCounts,
  normalizeSearch,
  patchInbox,
  priorityLabel,
  slugFromInboxStatus,
} from './model'

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()
const sla = (minutes: number) =>
  formatSla({ status: 'in_progress', slaDueAt: at(minutes), firstResponseAt: null }, NOW)

describe('INBOX_FILTERS', () => {
  it('follows the canvas order: Todos, then the four statuses', () => {
    expect(INBOX_FILTERS.map((filter) => filter.label)).toEqual([
      'Todos',
      'Por responder',
      'Nuevos',
      'Esperando al cliente',
      'Cerrados',
    ])
  })

  it('uses the status tones of the brief', () => {
    expect(Object.fromEntries(INBOX_FILTERS.map((f) => [f.label, f.tone]))).toEqual({
      Todos: 'neutral',
      'Por responder': 'warn',
      Nuevos: 'accent',
      'Esperando al cliente': 'waiting',
      Cerrados: 'closed',
    })
  })
})

describe('slugs', () => {
  it.each([
    ['por-responder', 'to_reply'],
    ['nuevos', 'new'],
    ['esperando', 'waiting'],
    ['cerrados', 'closed'],
  ] as const)('%s ⇄ %s', (slug, status) => {
    expect(inboxStatusFromSlug(slug)).toBe(status)
    expect(slugFromInboxStatus(status)).toBe(slug)
  })

  it('treats absent, unknown and old slugs as Todos', () => {
    expect(inboxStatusFromSlug(null)).toBeNull()
    expect(inboxStatusFromSlug('')).toBeNull()
    for (const old of ['en-curso', 'por-llamar', 'en-espera', 'otra-cosa']) {
      expect(inboxStatusFromSlug(old)).toBeNull()
    }
    expect(slugFromInboxStatus(null)).toBeNull()
  })
})

describe('countForFilter', () => {
  it('reads the matching counter, `all` for Todos and `closed` for Cerrados', () => {
    const counts = makeCounts({ all: 7, toReply: 3, new: 2, waiting: 2, closed: 4 })
    expect(INBOX_FILTERS.map((filter) => countForFilter(counts, filter.status))).toEqual([
      7, 3, 2, 2, 4,
    ])
  })
})

describe('inboxStatusMeta', () => {
  it.each([
    ['new', 'Nuevos', 'Nuevo', 'accent'],
    ['to_reply', 'Por responder', 'Por responder', 'warn'],
    ['waiting', 'Esperando al cliente', 'Esperando al cliente', 'waiting'],
    ['closed', 'Cerrados', 'Cerrado', 'closed'],
  ] as const)('%s → %s · %s', (inboxStatus, label, subLabel, tone) => {
    expect(inboxStatusMeta({ inboxStatus })).toEqual({ label, subLabel, tone })
  })

  it('labels a queued case (in no inbox)', () => {
    expect(inboxStatusMeta({ inboxStatus: null })).toEqual({
      label: 'Sin asignar',
      subLabel: 'En la cola',
      tone: 'neutral',
    })
  })
})

describe('labels', () => {
  it('names the two chat channels for the card and the header', () => {
    expect(channelLabel('app_chat')).toBe('App')
    expect(channelLabel('web_chat')).toBe('Web')
    expect(channelPhrase('app_chat')).toBe('chat en la app')
    expect(channelPhrase('web_chat')).toBe('chat web')
  })

  it('names priorities and countries', () => {
    expect(priorityLabel('medium')).toBe('Prioridad media')
    expect(priorityLabel('low')).toBe('Prioridad baja')
    expect(priorityLabel('high')).toBe('Prioridad alta')
    expect(countryName('MX')).toBe('México')
    expect(countryName('BR')).toBe('Brasil')
  })

  it('builds the card line: priority and channel', () => {
    expect(caseCardLine(makeCaseSummary())).toBe('Prioridad media · Web')
    expect(caseCardLine(makeCaseSummary({ channel: 'app_chat', priority: 'low' }))).toBe(
      'Prioridad baja · App',
    )
  })

  it('has the five close reasons in contract order', () => {
    expect(CLOSE_REASONS.map((reason) => [reason.value, reason.label])).toEqual([
      ['resolved', 'Resuelto'],
      ['customer_unresponsive', 'El cliente no respondió'],
      ['duplicate', 'Duplicado'],
      ['out_of_scope', 'Fuera de alcance'],
      ['other', 'Otro'],
    ])
    expect(closeReasonLabel('customer_unresponsive')).toBe('El cliente no respondió')
    expect(closeReasonLabel(null)).toBe('Sin motivo')
  })

  it('tags a case that continues a closed one', () => {
    expect(RETURNED_TAG.label).toBe('Volvió a escribir')
  })
})

describe('formatSla (first response)', () => {
  it('counts minutes up, hours and days down', () => {
    expect(sla(9)).toEqual({ text: 'SLA 9 min', atRisk: false })
    expect(sla(8.2)).toEqual({ text: 'SLA 9 min', atRisk: false })
    expect(sla(58)).toEqual({ text: 'SLA 58 min', atRisk: false })
    expect(sla(60)).toEqual({ text: 'SLA 1 h', atRisk: false })
    expect(sla(5 * 60 + 59)).toEqual({ text: 'SLA 5 h', atRisk: false })
    expect(sla(47 * 60 + 59)).toEqual({ text: 'SLA 47 h', atRisk: false })
    expect(sla(48 * 60)).toEqual({ text: 'SLA 2 días', atRisk: false })
    expect(sla(5 * 24 * 60)).toEqual({ text: 'SLA 5 días', atRisk: false })
  })

  it('is at risk from 5 minutes left', () => {
    expect(SLA_AT_RISK_MS).toBe(5 * 60_000)
    expect(sla(5)).toEqual({ text: 'SLA 5 min', atRisk: true })
    expect(sla(3)).toEqual({ text: 'SLA 3 min', atRisk: true })
    expect(sla(5.1)?.atRisk).toBe(false)
  })

  it('says "vencido" once the due time passed', () => {
    expect(sla(0)).toEqual({ text: 'SLA vencido', atRisk: true })
    expect(sla(-30)).toEqual({ text: 'SLA vencido', atRisk: true })
  })

  it('stops after the first response and on a closed case', () => {
    expect(
      formatSla({ status: 'in_progress', slaDueAt: at(-30), firstResponseAt: at(-40) }, NOW),
    ).toBeNull()
    expect(formatSla({ status: 'closed', slaDueAt: at(3), firstResponseAt: null }, NOW)).toBeNull()
  })
})

describe('relative times on the card', () => {
  it('shows the last interaction', () => {
    expect(formatLastInteraction({ lastInteractionAt: at(-2) }, NOW)).toBe('hace 2 min')
  })

  it('shows how long ago a case was closed', () => {
    expect(formatClosedAgo({ closedAt: at(-3 * 60) }, NOW)).toBe('Cerrado hace 3 h')
    expect(formatClosedAgo({ closedAt: null }, NOW)).toBe('Cerrado')
  })
})

describe('copy', () => {
  it('says what an empty list means per filter', () => {
    expect(emptyListCopy(null, false)).toBe('Nada pendiente.')
    expect(emptyListCopy('to_reply', false)).toBe('Nada pendiente.')
    expect(emptyListCopy('closed', false)).toBe('No cerraste casos en los últimos 7 días.')
    expect(emptyListCopy('closed', true)).toBe('Ningún caso coincide con tu búsqueda.')
  })

  it('toasts a new case, or the customer who wrote again', () => {
    expect(assignedToastCopy(makeCaseSummary())).toEqual({
      title: 'Te llegó un caso nuevo',
      description: 'Marcela Quintana Pardo',
    })
    expect(assignedToastCopy(makeCaseSummary({ previousCaseId: 'CASE-1' }))).toEqual({
      title: 'Marcela volvió a escribir',
      description: 'Marcela Quintana Pardo',
    })
  })

  it('says when a supervisor assigned the case (slice 3)', () => {
    expect(
      assignedToastCopy(makeCaseSummary({ previousCaseId: 'CASE-1' }), { fromSupervisor: true }),
    ).toEqual({
      title: 'Te asignaron un caso',
      description: 'Marcela Quintana Pardo · desde supervisión',
    })
  })

  it('explains a case supervision took away (case.unassigned)', () => {
    expect(unassignedToastCopy(makeCaseSummary())).toEqual({
      title: 'Supervisión reasignó un caso',
      description:
        'El caso de Marcela Quintana Pardo pasó a otra persona del equipo. Puedes leerlo, pero ya no responder.',
    })
  })
})

describe('normalizeSearch', () => {
  it('trims and caps at 80 characters', () => {
    expect(normalizeSearch('  Marcela  ')).toBe('Marcela')
    expect(normalizeSearch('   ')).toBe('')
    expect(normalizeSearch('a'.repeat(100))).toHaveLength(80)
  })
})

describe('freshness guards', () => {
  it('applies counts that are not older than the cache', () => {
    const cached = makeCounts({ computedAt: at(0) })
    expect(isNewerCounts(makeCounts({ computedAt: at(1) }), cached)).toBe(true)
    expect(isNewerCounts(makeCounts({ computedAt: at(0) }), cached)).toBe(true)
    expect(isNewerCounts(makeCounts({ computedAt: at(-1) }), cached)).toBe(false)
    expect(isNewerCounts(makeCounts(), undefined)).toBe(true)
  })

  it('applies a case only when its version is newer', () => {
    expect(isNewerCase({ version: 4 }, { version: 3 })).toBe(true)
    expect(isNewerCase({ version: 3 }, { version: 3 })).toBe(false)
    expect(isNewerCase({ version: 2 }, undefined)).toBe(true)
  })
})

describe('fitsInboxFilter', () => {
  it('keeps Todos to the open cases and every other filter to its status', () => {
    expect(fitsInboxFilter('new', null)).toBe(true)
    expect(fitsInboxFilter('waiting', null)).toBe(true)
    expect(fitsInboxFilter('closed', null)).toBe(false)
    expect(fitsInboxFilter('closed', 'closed')).toBe(true)
    expect(fitsInboxFilter('to_reply', 'closed')).toBe(false)
    expect(fitsInboxFilter(null, null)).toBe(false)
  })
})

describe('patchInbox', () => {
  const card = makeCaseSummary()
  const inbox = makeInbox([card])

  it('patches a newer card in place, refetching only when its placement changes', () => {
    const preview = makeCaseSummary({ version: 4, preview: 'hola', unreadCount: 3 })
    expect(patchInbox(inbox, null, preview)).toEqual({
      inbox: { ...inbox, items: [preview] },
      refetch: false,
    })
    const moved = makeCaseSummary({ version: 4, inboxStatus: 'waiting' })
    expect(patchInbox(inbox, 'to_reply', moved).refetch).toBe(true)
  })

  it('ignores an older or repeated version', () => {
    expect(patchInbox(inbox, null, makeCaseSummary({ preview: 'x' }))).toEqual({
      inbox,
      refetch: false,
    })
  })

  it('refetches for an unknown case only when it fits the filter', () => {
    const fresh = makeCaseSummary({ id: 'CASE-NEW', inboxStatus: 'new', status: 'assigned' })
    expect(patchInbox(inbox, null, fresh)).toEqual({ inbox, refetch: true })
    expect(patchInbox(inbox, 'new', fresh).refetch).toBe(true)
    expect(patchInbox(inbox, 'to_reply', fresh).refetch).toBe(false)
    const queued = makeCaseSummary({ id: 'CASE-Q', inboxStatus: null, status: 'queued' })
    expect(patchInbox(inbox, null, queued).refetch).toBe(false)
  })

  it('moves a closed case out of Todos and into Cerrados', () => {
    const closed = makeCaseSummary({
      version: 9,
      status: 'closed',
      inboxStatus: 'closed',
      closedAt: NOW.toISOString(),
      closeReason: 'resolved',
    })
    // Todos holds the card: its placement changed, so it refetches (the card leaves).
    expect(patchInbox(inbox, null, closed).refetch).toBe(true)
    // Cerrados does not hold it yet: it fits, so it refetches (the card enters).
    expect(patchInbox(makeInbox([]), 'closed', closed).refetch).toBe(true)
    // An open filter that never held it ignores it.
    expect(patchInbox(makeInbox([]), 'to_reply', closed).refetch).toBe(false)
  })
})

describe('changesInboxPlacement', () => {
  const card = makeCaseSummary()

  it('flags the fields that decide membership and order, not the card text', () => {
    expect(changesInboxPlacement(card, { ...card, preview: 'x', unreadCount: 9 })).toBe(false)
    expect(changesInboxPlacement(card, { ...card, slaDueAt: NOW.toISOString() })).toBe(false)
    expect(changesInboxPlacement(card, { ...card, firstResponseAt: NOW.toISOString() })).toBe(false)
    expect(changesInboxPlacement(card, { ...card, status: 'closed' })).toBe(true)
    expect(changesInboxPlacement(card, { ...card, inboxStatus: 'waiting' })).toBe(true)
    expect(changesInboxPlacement(card, { ...card, lastInteractionAt: NOW.toISOString() })).toBe(
      true,
    )
    expect(changesInboxPlacement(card, { ...card, assignedAnalystId: 'STF-OTHER' })).toBe(true)
    expect(changesInboxPlacement(card, { ...card, closedAt: NOW.toISOString() })).toBe(true)
  })
})
