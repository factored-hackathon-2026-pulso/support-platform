import { describe, expect, it } from 'vitest'
import { NOW, makeCaseSummary, makeCounts, makeInbox } from '@/test/case-fixtures'
import {
  INBOX_FILTERS,
  caseCardLine,
  changesInboxPlacement,
  channelLabel,
  channelPhrase,
  countForFilter,
  countryName,
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
  topicLabel,
} from './model'

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()
const sla = (minutes: number) =>
  formatSla({ status: 'in_progress', slaDueAt: at(minutes), liveSince: null }, NOW)

describe('INBOX_FILTERS', () => {
  it('follows the canvas order', () => {
    expect(INBOX_FILTERS.map((filter) => filter.label)).toEqual([
      'Todos',
      'Por responder',
      'En curso',
      'Nuevos',
      'Por llamar',
      'En espera',
    ])
  })

  it('uses the status tones of the brief', () => {
    expect(Object.fromEntries(INBOX_FILTERS.map((f) => [f.label, f.tone]))).toEqual({
      Todos: 'neutral',
      'Por responder': 'warn',
      'En curso': 'success',
      Nuevos: 'accent',
      'Por llamar': 'callout',
      'En espera': 'waiting',
    })
  })
})

describe('slugs', () => {
  it.each([
    ['por-responder', 'to_reply'],
    ['en-curso', 'live'],
    ['nuevos', 'new'],
    ['por-llamar', 'to_call'],
    ['en-espera', 'waiting'],
  ] as const)('%s ⇄ %s', (slug, status) => {
    expect(inboxStatusFromSlug(slug)).toBe(status)
    expect(slugFromInboxStatus(status)).toBe(slug)
  })

  it('treats absent or unknown slugs as Todos', () => {
    expect(inboxStatusFromSlug(null)).toBeNull()
    expect(inboxStatusFromSlug('')).toBeNull()
    expect(inboxStatusFromSlug('cerrados')).toBeNull()
    expect(slugFromInboxStatus(null)).toBeNull()
  })
})

describe('countForFilter', () => {
  it('reads the matching counter, and `all` for Todos', () => {
    const counts = makeCounts({ all: 7, toReply: 3, live: 1, new: 1, toCall: 1, waiting: 1 })
    expect(INBOX_FILTERS.map((filter) => countForFilter(counts, filter.status))).toEqual([
      7, 3, 1, 1, 1, 1,
    ])
  })
})

describe('inboxStatusMeta', () => {
  it.each([
    ['assigned', 'new', 'Nuevos', 'Nuevo', 'accent'],
    ['in_progress', 'to_reply', 'Por responder', 'Por responder', 'warn'],
    ['in_progress', 'waiting', 'En espera', 'Esperando al cliente', 'waiting'],
    ['awaiting_approval', 'waiting', 'En espera', 'Esperando aprobación', 'waiting'],
    ['in_call', 'live', 'En curso', 'En llamada', 'success'],
    ['to_call', 'to_call', 'Por llamar', 'Por llamar', 'callout'],
  ] as const)('%s / %s → %s · %s', (status, inboxStatus, label, subLabel, tone) => {
    expect(inboxStatusMeta({ status, inboxStatus })).toEqual({ label, subLabel, tone })
  })

  it('labels cases outside the inbox', () => {
    expect(inboxStatusMeta({ status: 'closed', inboxStatus: null }).label).toBe('Cerrado')
    expect(inboxStatusMeta({ status: 'queued', inboxStatus: null }).tone).toBe('neutral')
  })
})

describe('labels', () => {
  it('names channels for the card and the header', () => {
    expect(['app_chat', 'web_chat', 'phone', 'email'].map((c) => channelLabel(c as never))).toEqual(
      ['App', 'Web', 'Teléfono', 'Correo'],
    )
    expect(channelPhrase('app_chat')).toBe('chat en la app')
    expect(channelPhrase('web_chat')).toBe('chat web')
  })

  it('names priorities, topics and countries', () => {
    expect(priorityLabel('medium')).toBe('Prioridad media')
    expect(priorityLabel('low')).toBe('Prioridad baja')
    expect(topicLabel('disputar_cargo')).toBe('Cargo no reconocido')
    expect(topicLabel('hablar_con_humano')).toBe('Pide una persona')
    expect(topicLabel(null)).toBe('Sin clasificar')
    expect(countryName('MX')).toBe('México')
  })

  it('builds the card line', () => {
    expect(caseCardLine(makeCaseSummary())).toBe('Prioridad media · Web · Cargo no reconocido')
    expect(caseCardLine(makeCaseSummary({ channel: 'app_chat', topic: null }))).toBe(
      'Prioridad media · App · Sin clasificar',
    )
  })
})

describe('formatSla', () => {
  it('counts minutes up, hours and days down', () => {
    expect(sla(9)).toEqual({ text: 'SLA 9 min', atRisk: true })
    expect(sla(8.2)).toEqual({ text: 'SLA 9 min', atRisk: true })
    expect(sla(58)).toEqual({ text: 'SLA 58 min', atRisk: false })
    expect(sla(60)).toEqual({ text: 'SLA 1 h', atRisk: false })
    expect(sla(5 * 60 + 59)).toEqual({ text: 'SLA 5 h', atRisk: false })
    expect(sla(47 * 60 + 59)).toEqual({ text: 'SLA 47 h', atRisk: false })
    expect(sla(48 * 60)).toEqual({ text: 'SLA 2 días', atRisk: false })
    expect(sla(5 * 24 * 60)).toEqual({ text: 'SLA 5 días', atRisk: false })
  })

  it('is at risk from 15 minutes left', () => {
    expect(sla(15).atRisk).toBe(true)
    expect(sla(15.1).atRisk).toBe(false)
  })

  it('says "vencido" once the due time passed', () => {
    expect(sla(0)).toEqual({ text: 'SLA vencido', atRisk: true })
    expect(sla(-30)).toEqual({ text: 'SLA vencido', atRisk: true })
  })

  it('shows the call timer for a live call', () => {
    const liveSince = new Date(NOW.getTime() - 246_000).toISOString()
    expect(formatSla({ status: 'in_call', slaDueAt: at(-10), liveSince }, NOW)).toEqual({
      text: 'En llamada · 04:06',
      atRisk: false,
    })
    expect(formatSla({ status: 'in_call', slaDueAt: at(10), liveSince: null }, NOW).text).toBe(
      'En llamada',
    )
  })
})

describe('formatLastInteraction', () => {
  it('is relative, and "ahora" during a call', () => {
    expect(formatLastInteraction({ status: 'in_progress', lastInteractionAt: at(-2) }, NOW)).toBe(
      'hace 2 min',
    )
    expect(formatLastInteraction({ status: 'in_call', lastInteractionAt: at(-30) }, NOW)).toBe(
      'ahora',
    )
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
    const closed = makeCaseSummary({ id: 'CASE-OLD', inboxStatus: null, status: 'closed' })
    expect(patchInbox(inbox, null, closed).refetch).toBe(false)
  })
})

describe('changesInboxPlacement', () => {
  const card = makeCaseSummary()

  it('flags the fields that decide membership and order, not the card text', () => {
    expect(changesInboxPlacement(card, { ...card, preview: 'x', unreadCount: 9 })).toBe(false)
    expect(changesInboxPlacement(card, { ...card, status: 'closed' })).toBe(true)
    expect(changesInboxPlacement(card, { ...card, slaDueAt: NOW.toISOString() })).toBe(true)
    expect(changesInboxPlacement(card, { ...card, liveSince: NOW.toISOString() })).toBe(true)
    expect(changesInboxPlacement(card, { ...card, assignedAnalystId: 'STF-OTHER' })).toBe(true)
  })
})
