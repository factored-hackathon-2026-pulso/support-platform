import { describe, expect, it } from 'vitest'
import { NOW, makeCaseSummary, makeCounts, makeInbox } from '@/test/case-fixtures'
import {
  ESCALATED_MARKER,
  ESCALATION_STATE,
  MAX_ESCALATION_TEXT,
  escalationWaitFact,
  isAttendedEscalation,
  CASE_STATUS,
  CLOSE_REASONS,
  INBOX_FILTERS,
  OPEN_CASE_STATUS,
  caseLifecycleStatus,
  caseStatus,
  RETURNED_TAG,
  SLA_AT_RISK_MS,
  caseCardFacts,
  changesInboxPlacement,
  channelLabel,
  caseChannel,
  channelFact,
  closeReasonLabel,
  closeReasonOption,
  countForFilter,
  countryName,
  emptyListCopy,
  filterChipLabel,
  slaFact,
  sortByUrgency,
  urgencyGroup,
  fitsInboxFilter,
  formatClosedAgo,
  formatLastInteraction,
  formatSla,
  parseInboxStatus,
  inboxStatusMeta,
  isNewerCase,
  isNewerCounts,
  normalizeSearch,
  patchInbox,
  CASE_PRIORITY,
  PRIORITY_OPTIONS,
  casePriority,
  isUrgentPriority,
  priorityFact,
  priorityLabel,
  priorityMenuLabel,
  RATING_SCALE,
  ratingFact,
  ratingLabel,
  ratingOption,
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

describe('parseInboxStatus', () => {
  it.each(['to_reply', 'new', 'waiting', 'closed'] as const)('reads ?status=%s', (status) => {
    expect(parseInboxStatus(status)).toBe(status)
  })

  it('treats absent and unknown values as Todos', () => {
    for (const value of [null, undefined, '', 'queued', 'cerrados', 'otra-cosa']) {
      expect(parseInboxStatus(value)).toBeNull()
    }
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

describe('case status (the one map)', () => {
  it.each([
    ['new', 'Nuevos', 'Nuevo', 'accent'],
    ['to_reply', 'Por responder', 'Por responder', 'warn'],
    ['waiting', 'Esperando al cliente', 'Esperando al cliente', 'waiting'],
    ['closed', 'Cerrados', 'Cerrado', 'closed'],
  ] as const)('%s → %s · %s', (inboxStatus, label, subLabel, tone) => {
    expect(inboxStatusMeta({ inboxStatus })).toEqual({ label, subLabel, tone })
  })

  it('labels a queued case (in no inbox) "Sin asignar"', () => {
    expect(inboxStatusMeta({ inboxStatus: null })).toEqual({
      label: 'Sin asignar',
      subLabel: 'Sin asignar',
      tone: 'neutral',
    })
  })

  it('draws each status Linear-style: dashed, ring, ¾ pie, ½ pie, check', () => {
    expect(
      (['queued', 'new', 'to_reply', 'waiting', 'closed'] as const).map((key) => [
        key,
        CASE_STATUS[key].shape,
        CASE_STATUS[key].tone,
        CASE_STATUS[key].label,
      ]),
    ).toEqual([
      ['queued', 'dashed', 'neutral', 'Sin asignar'],
      ['new', 'ring', 'accent', 'Nuevo'],
      ['to_reply', 'pie-75', 'warn', 'Por responder'],
      ['waiting', 'pie-50', 'waiting', 'Esperando al cliente'],
      ['closed', 'check', 'closed', 'Cerrado'],
    ])
    // Only the status that asks for her action is emphasized.
    expect(Object.values(CASE_STATUS).filter((status) => status.strong)).toHaveLength(1)
  })

  it('hands the appearance to the Status primitive (no bucket) and reads null as queued', () => {
    expect(caseStatus('to_reply')).toEqual({
      shape: 'pie-75',
      tone: 'warn',
      label: 'Por responder',
      strong: true,
    })
    expect(caseStatus('new')).toEqual({ shape: 'ring', tone: 'accent', label: 'Nuevo' })
    expect(caseStatus(null)).toEqual({ shape: 'dashed', tone: 'neutral', label: 'Sin asignar' })
  })

  it('reads a past case by its lifecycle: queued, open ("Abierto") or closed', () => {
    expect(caseLifecycleStatus('queued').label).toBe('Sin asignar')
    expect(caseLifecycleStatus('assigned')).toEqual(OPEN_CASE_STATUS)
    expect(caseLifecycleStatus('in_progress')).toEqual({
      shape: 'pie-25',
      tone: 'accent',
      label: 'Abierto',
    })
    expect(caseLifecycleStatus('closed')).toEqual({
      shape: 'check',
      tone: 'closed',
      label: 'Cerrado',
    })
  })

  it('names and colors the filters from the same map', () => {
    expect(INBOX_FILTERS.map((filter) => [filter.label, filter.tone])).toEqual([
      ['Todos', 'neutral'],
      ['Por responder', 'warn'],
      ['Nuevos', 'accent'],
      ['Esperando al cliente', 'waiting'],
      ['Cerrados', 'closed'],
    ])
  })
})

describe('labels', () => {
  it('names the five channels with one icon each (slice 12)', () => {
    expect(channelLabel('chat_app')).toBe('Chat en la app')
    expect(channelLabel('chat_web')).toBe('Chat web')
    expect(channelLabel('phone_inbound')).toBe('Llamada entrante')
    expect(channelLabel('phone_outbound')).toBe('Llamada saliente')
    expect(channelLabel('email')).toBe('Correo')
    expect(caseChannel('chat_app').icon).toBe('message')
    expect(caseChannel('chat_web').icon).toBe('message')
    expect(caseChannel('phone_inbound')).toMatchObject({ icon: 'phone-incoming', kind: 'phone' })
    expect(caseChannel('phone_outbound')).toMatchObject({ icon: 'phone-outgoing', kind: 'phone' })
    expect(caseChannel('email')).toMatchObject({ icon: 'mail', kind: 'email' })
  })

  it('shows the channel as an icon-only fact with the label as tooltip', () => {
    expect(channelFact('phone_outbound')).toEqual({
      key: 'channel',
      icon: 'phone-outgoing',
      text: 'Llamada saliente',
      label: 'Canal',
      iconOnly: true,
    })
  })

  it('names priorities and countries', () => {
    expect(priorityLabel('medium')).toBe('Prioridad media')
    expect(priorityLabel('low')).toBe('Prioridad baja')
    expect(priorityLabel('high')).toBe('Prioridad alta')
    expect(priorityLabel('critical')).toBe('Prioridad crítica')
    expect(priorityLabel('none')).toBe('Sin prioridad')
    expect(countryName('MX')).toBe('México')
    expect(countryName('BR')).toBe('Brasil')
  })

  it('builds the card facts: channel, priority only when high, a customer who came back', () => {
    expect(caseCardFacts(makeCaseSummary())).toEqual([
      { key: 'channel', icon: 'message', text: 'Chat web', label: 'Canal', iconOnly: true },
    ])
    expect(
      caseCardFacts(
        makeCaseSummary({ channel: 'chat_app', priority: 'high', previousCaseId: 'CASE-1' }),
      ),
    ).toEqual([
      {
        key: 'channel',
        icon: 'message',
        text: 'Chat en la app',
        label: 'Canal',
        iconOnly: true,
      },
      { key: 'priority', icon: 'priority-high', text: 'Prioridad alta', iconOnly: true },
      {
        key: 'returned',
        icon: 'history',
        text: 'Volvió a escribir',
        tone: 'accent',
        iconOnly: true,
      },
    ])
    // None, low and medium are not shown on a card; critical is.
    for (const priority of ['none', 'low', 'medium'] as const) {
      expect(caseCardFacts(makeCaseSummary({ priority })).map((f) => f.key)).toEqual(['channel'])
    }
    expect(caseCardFacts(makeCaseSummary({ priority: 'critical' }))[1]).toEqual({
      key: 'priority',
      icon: 'priority-critical',
      text: 'Prioridad crítica',
      iconOnly: true,
    })
  })

  it('has the five close reasons in contract order', () => {
    expect(CLOSE_REASONS.map((reason) => [reason.value, reason.label])).toEqual([
      ['resolved', 'Resuelto'],
      ['customer_unresponsive', 'El cliente no respondió'],
      ['duplicate', 'Duplicado'],
      ['out_of_scope', 'Fuera de alcance'],
      ['other', 'Otro'],
    ])
    expect(CLOSE_REASONS.map((reason) => [reason.label, reason.tone, reason.meaning])).toEqual([
      ['Resuelto', 'success', 'Se atendió lo que pidió.'],
      ['El cliente no respondió', 'closed', 'Dejó de contestar y no se pudo seguir.'],
      ['Duplicado', 'accent', 'Ya hay otro caso por lo mismo.'],
      ['Fuera de alcance', 'warn', 'Lo que pide no lo atiende este equipo.'],
      ['Otro', 'neutral', 'Cuéntalo en la nota interna.'],
    ])
    expect(closeReasonOption('duplicate').tone).toBe('accent')
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
    expect(formatClosedAgo({ closedAt: at(-3 * 60) }, NOW)).toBe('hace 3 h')
    expect(formatClosedAgo({ closedAt: null }, NOW)).toBeNull()
  })
})

describe('copy', () => {
  it('says what an empty list means per filter', () => {
    expect(emptyListCopy(null, false)).toBe('Nada pendiente.')
    expect(emptyListCopy('to_reply', false)).toBe('Ningún caso espera tu respuesta.')
    expect(emptyListCopy('new', false)).toBe('No tienes casos nuevos.')
    expect(emptyListCopy('waiting', false)).toBe('Ningún caso espera al cliente.')
    expect(emptyListCopy('closed', false)).toBe('No cerraste casos en los últimos 7 días.')
    expect(emptyListCopy('closed', true)).toBe('Ningún caso coincide con tu búsqueda.')
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

describe('priority (slice 8: the one map)', () => {
  it('has five levels with their word, glyph and menu order', () => {
    expect(PRIORITY_OPTIONS.map((option) => [option.value, option.label, option.icon])).toEqual([
      ['none', 'Sin prioridad', 'priority-none'],
      ['critical', 'Crítica', 'priority-critical'],
      ['high', 'Alta', 'priority-high'],
      ['medium', 'Media', 'priority-medium'],
      ['low', 'Baja', 'priority-low'],
    ])
    expect(Object.keys(CASE_PRIORITY).sort()).toEqual(['critical', 'high', 'low', 'medium', 'none'])
    expect(casePriority('nope' as 'none').label).toBe('Sin prioridad')
  })

  it('flags only high and critical on cards; supervision shows every level', () => {
    expect(
      ['none', 'low', 'medium', 'high', 'critical'].filter((p) => isUrgentPriority(p as 'none')),
    ).toEqual(['high', 'critical'])
    expect(priorityFact('medium')).toBeNull()
    expect(priorityFact('medium', { onlyUrgent: false })).toEqual({
      key: 'priority',
      icon: 'priority-medium',
      text: 'Prioridad media',
      iconOnly: true,
    })
    expect(priorityFact('none', { onlyUrgent: false })?.text).toBe('Sin prioridad')
  })

  it('names the menu trigger with the value and the action', () => {
    expect(priorityMenuLabel('high')).toBe('Prioridad: Alta. Cambiar la prioridad')
    expect(priorityMenuLabel('none')).toBe('Prioridad: Sin prioridad. Cambiar la prioridad')
  })
})

describe('urgency order (Inicio "Lo primero" and the Casos list)', () => {
  const overdue = makeCaseSummary({
    id: 'CASE-A',
    inboxStatus: 'new',
    status: 'assigned',
    firstResponseAt: null,
    slaDueAt: at(-3),
  })
  const atRisk = makeCaseSummary({
    id: 'CASE-B',
    inboxStatus: 'to_reply',
    firstResponseAt: null,
    slaDueAt: at(4),
  })
  const running = makeCaseSummary({
    id: 'CASE-C',
    inboxStatus: 'new',
    status: 'assigned',
    firstResponseAt: null,
    slaDueAt: at(12),
  })
  const runningLater = makeCaseSummary({ ...running, id: 'CASE-D', slaDueAt: at(14) })
  const answeredLongAgo = makeCaseSummary({
    id: 'CASE-E',
    inboxStatus: 'to_reply',
    firstResponseAt: at(-30),
    lastInteractionAt: at(-20),
  })
  const answeredRecently = makeCaseSummary({
    ...answeredLongAgo,
    id: 'CASE-F',
    lastInteractionAt: at(-1),
  })
  const waiting = makeCaseSummary({
    id: 'CASE-G',
    inboxStatus: 'waiting',
    firstResponseAt: at(-40),
    lastInteractionAt: at(-50),
  })
  const waitingWithSla = makeCaseSummary({
    id: 'CASE-H',
    inboxStatus: 'waiting',
    firstResponseAt: null,
    slaDueAt: at(-10),
    lastInteractionAt: at(-5),
  })

  // Slice 8: a critical case with its SLA still running, and a high one already answered.
  const critical = makeCaseSummary({
    ...running,
    id: 'CASE-I',
    slaDueAt: at(13),
    priority: 'critical',
  })
  const high = makeCaseSummary({ ...answeredRecently, id: 'CASE-J', priority: 'high' })
  const highOverdue = makeCaseSummary({
    ...overdue,
    id: 'CASE-K',
    slaDueAt: at(-1),
    priority: 'high',
  })
  const criticalWaiting = makeCaseSummary({ ...waiting, id: 'CASE-L', priority: 'critical' })

  it('groups: overdue, critical, high, SLA running, no SLA, waiting for the customer', () => {
    expect(urgencyGroup(overdue, NOW)).toBe(0)
    expect(urgencyGroup(highOverdue, NOW)).toBe(0)
    expect(urgencyGroup(critical, NOW)).toBe(1)
    expect(urgencyGroup(high, NOW)).toBe(2)
    expect(urgencyGroup(atRisk, NOW)).toBe(3)
    expect(urgencyGroup(running, NOW)).toBe(3)
    expect(urgencyGroup(answeredLongAgo, NOW)).toBe(4)
    expect(urgencyGroup(waiting, NOW)).toBe(5)
    expect(urgencyGroup(waitingWithSla, NOW)).toBe(5)
    expect(urgencyGroup(criticalWaiting, NOW)).toBe(5) // the customer has the ball
    expect(urgencyGroup(makeCaseSummary({ status: 'closed', inboxStatus: 'closed' }), NOW)).toBe(6)
  })

  it('sorts overdue first, then critical and high, then the nearest SLA, waiting last', () => {
    const shuffled = [
      waiting,
      answeredRecently,
      high,
      runningLater,
      atRisk,
      waitingWithSla,
      critical,
      running,
      answeredLongAgo,
      highOverdue,
      overdue,
    ]
    expect(sortByUrgency(shuffled, NOW).map((item) => item.id)).toEqual([
      'CASE-A',
      'CASE-K',
      'CASE-I',
      'CASE-J',
      'CASE-B',
      'CASE-C',
      'CASE-D',
      'CASE-E',
      'CASE-F',
      'CASE-G',
      'CASE-H',
    ])
    expect(shuffled[0]).toBe(waiting) // the input is not changed
  })

  it('moves a case up as its SLA comes due', () => {
    const later = new Date(NOW.getTime() + 13 * 60_000)
    expect(urgencyGroup(running, later)).toBe(0)
    expect(sortByUrgency([answeredLongAgo, running], later).map((item) => item.id)).toEqual([
      'CASE-C',
      'CASE-E',
    ])
  })

  it('breaks ties by id', () => {
    const twin = makeCaseSummary({ ...running, id: 'CASE-0' })
    expect(sortByUrgency([running, twin], NOW).map((item) => item.id)).toEqual(['CASE-0', 'CASE-C'])
  })
})

describe('filterChipLabel', () => {
  it('names the filter of the URL; Todos has no chip', () => {
    expect(filterChipLabel(null)).toBeNull()
    expect(filterChipLabel('closed')).toBe('Cerrados')
    expect(filterChipLabel('to_reply')).toBe('Por responder')
    expect(filterChipLabel('new')).toBe('Nuevos')
    expect(filterChipLabel('waiting')).toBe('Esperando al cliente')
  })
})

describe('slaFact (the shared SLA level → icon/tone map)', () => {
  const pending = (minutes: number) => ({
    status: 'in_progress' as const,
    slaDueAt: at(minutes),
    firstResponseAt: null,
  })

  it('overdue: filled flame, danger, "Vencido"', () => {
    expect(slaFact(pending(-1), NOW)).toEqual({
      key: 'sla',
      level: 'overdue',
      icon: 'flame-filled',
      tone: 'danger',
      text: 'Vencido',
      label: 'SLA de primera respuesta',
      tooltip: 'Primera respuesta vencida',
    })
  })

  it('at risk (≤ 5 min): flame in warn, the minutes left', () => {
    expect(slaFact(pending(1), NOW)).toMatchObject({
      level: 'at_risk',
      icon: 'flame',
      tone: 'warn',
      text: '1 min',
      tooltip: 'Vence en 1 min',
    })
    expect(slaFact(pending(5), NOW)?.level).toBe('at_risk')
  })

  it('running: clock in muted, the time left, never the word "SLA" in the value', () => {
    expect(slaFact(pending(12), NOW)).toMatchObject({
      level: 'normal',
      icon: 'clock',
      tone: 'muted',
      text: '12 min',
      tooltip: 'Primera respuesta: vence en 12 min',
    })
    expect(slaFact(pending(5 * 60), NOW)?.text).toBe('5 h')
    expect(slaFact(pending(3 * 24 * 60), NOW)?.text).toBe('3 días')
  })

  it('stops once answered or closed', () => {
    expect(slaFact({ ...pending(1), firstResponseAt: at(-1) }, NOW)).toBeNull()
    expect(slaFact({ ...pending(1), status: 'closed' }, NOW)).toBeNull()
  })
})

describe('customer rating (slice 7)', () => {
  it('maps each score to its word, face and tone', () => {
    expect(RATING_SCALE.map((o) => [o.score, o.label, o.icon, o.tone])).toEqual([
      [1, 'Mal', 'frown', 'danger'],
      [2, 'Regular', 'meh', 'warn'],
      [3, 'Bien', 'smile', 'success'],
      [4, 'Excelente', 'laugh', 'success'],
    ])
    expect(ratingOption(3.6).label).toBe('Excelente')
    expect(ratingOption(3.4).label).toBe('Bien')
    expect(ratingOption(0).label).toBe('Mal')
    expect(ratingOption(Number.NaN).label).toBe('Mal')
    expect(ratingLabel(null)).toBeNull()
    expect(ratingLabel({ score: 2 })).toBe('Regular')
  })

  it('shows a rating in a list as the colored face alone, named "Calificación: …"', () => {
    expect(ratingFact(null)).toBeNull()
    expect(ratingFact({ score: 3 })).toEqual({
      key: 'rating',
      icon: 'smile',
      text: 'Calificación: Bien',
      tone: 'success',
      iconOnly: true,
    })
    expect(ratingFact({ score: 4 })?.text).toBe('Calificación: Excelente')
    expect(ratingFact({ score: 1 })?.tone).toBe('danger')
  })
})

describe('escalations (slice 9)', () => {
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()

  it('marks an escalated case and names every outcome as glyph + word', () => {
    expect(ESCALATED_MARKER).toEqual({ shape: 'up', tone: 'warn', label: 'Escalado' })
    expect(ESCALATION_STATE.open).toMatchObject({ shape: 'ring', label: 'Abierto' })
    expect(ESCALATION_STATE.answered.label).toBe('Respondido')
    expect(ESCALATION_STATE.taken.label).toBe('Tomado')
    expect(ESCALATION_STATE.reassigned).toMatchObject({ shape: 'forward', label: 'Reasignado' })
    expect(['answered', 'taken', 'reassigned'].every((s) => isAttendedEscalation(s as never))).toBe(
      true,
    )
    expect(isAttendedEscalation('withdrawn')).toBe(false)
    expect(isAttendedEscalation('open')).toBe(false)
    expect(MAX_ESCALATION_TEXT).toBe(500)
  })

  it('emphasizes long waits (clock, orange flame > 15 min, red flame > 30 min)', () => {
    const open = (minutes: number) =>
      escalationWaitFact({ escalatedAt: at(-minutes), resolvedAt: null, state: 'open' }, NOW)
    expect(open(6)).toMatchObject({ level: 'normal', icon: 'clock', text: '6 min' })
    expect(open(6).tooltip).toBe('Espera desde hace 6 min')
    expect(open(15)).toMatchObject({ level: 'normal' })
    expect(open(18)).toMatchObject({ level: 'risk', icon: 'flame', tone: 'warn', text: '18 min' })
    expect(open(34)).toMatchObject({ level: 'long', icon: 'flame-filled', tone: 'danger' })
    expect(open(65).text).toBe('1 h 05 min')
    const answered = escalationWaitFact(
      { escalatedAt: at(-40), resolvedAt: at(-36), state: 'answered' },
      NOW,
    )
    expect(answered).toMatchObject({ level: 'normal', icon: 'clock', tone: 'muted', text: '4 min' })
    expect(answered.tooltip).toBe('Esperó 4 min')
  })
})
