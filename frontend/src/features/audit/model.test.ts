import { describe, expect, it } from 'vitest'
import { NOW } from '@/test/case-fixtures'
import { makeAuditEvent } from '@/test/audit-fixtures'
import {
  AUDIT_FAMILIES,
  AUDIT_KIND_FILTERS,
  EMPTY_AUDIT_STATE,
  actorName,
  actorRoleLabel,
  showsActorName,
  actorTone,
  auditFiltersOf,
  clearAuditFilters,
  dateRangeError,
  dayLabel,
  detailByline,
  detailKicker,
  emptyLogCopy,
  eventInstant,
  eventTime,
  familyLabel,
  groupByDay,
  hasAuditFilters,
  hidesMessageText,
  redactionNote,
  isDateKey,
  payloadLines,
  personOptionLabel,
  shownCountLabel,
  showsPersonFilter,
  withActorKind,
} from './model'
import type { AuditUrlState } from './url'

// The test process runs in America/Bogota (UTC−5), see vite.config.ts.

describe('labels', () => {
  it('names every family and kind of actor', () => {
    expect(AUDIT_FAMILIES.map((f) => f.value)).toEqual([
      'conversation',
      'assignment',
      'lifecycle',
      'availability',
      'access',
      'administration',
      'escalation',
      'agents',
      'other',
    ])
    expect(familyLabel('escalation')).toBe('Escalamientos')
    expect(familyLabel('agents')).toBe('Agentes e IA')
    expect(familyLabel('administration')).toBe('Administración')
    expect(personOptionLabel({ name: 'Andrés Villamil', active: false })).toBe(
      'Andrés Villamil (desactivada)',
    )
    expect(personOptionLabel({ name: 'Lucía Herrera', active: true })).toBe('Lucía Herrera')
    expect(AUDIT_KIND_FILTERS.map((k) => k.label)).toEqual([
      'Todos',
      'Equipo',
      'Clientes',
      'Plataforma',
    ])
    expect(isDateKey('2026-03-05')).toBe(true)
    expect(isDateKey('2026-3-5')).toBe(false)
  })
})

describe('filters', () => {
  const state = (patch: Partial<AuditUrlState>): AuditUrlState => ({
    ...EMPTY_AUDIT_STATE,
    ...patch,
  })

  it('converts the days of the viewer zone into UTC instants, Hasta inclusive', () => {
    expect(auditFiltersOf(state({ fromDate: '2026-03-05', toDate: '2026-03-05' }))).toEqual({
      from: '2026-03-05T05:00:00.000Z',
      to: '2026-03-06T05:00:00.000Z',
    })
    expect(auditFiltersOf(state({ toDate: '2026-03-31' }))).toEqual({
      to: '2026-04-01T05:00:00.000Z',
    })
  })

  it('sends only the filters that are set', () => {
    expect(auditFiltersOf(EMPTY_AUDIT_STATE)).toEqual({})
    expect(
      auditFiltersOf(
        state({
          actorKind: 'staff',
          actorId: 'STF-1',
          caseId: 'CASE-1',
          family: 'access',
          changesOnly: true,
          query: '  114 ',
          eventId: 'EVT-1',
        }),
      ),
    ).toEqual({
      actorKind: 'staff',
      actorId: 'STF-1',
      caseId: 'CASE-1',
      family: 'access',
      changesOnly: true,
      q: '114',
    })
  })

  it('drops the person filter for customers and the platform', () => {
    expect(showsPersonFilter({ actorKind: null })).toBe(true)
    expect(showsPersonFilter({ actorKind: 'customer' })).toBe(false)
    const withPerson = state({ actorId: 'STF-1' })
    expect(withActorKind(withPerson, 'staff').actorId).toBe('STF-1')
    expect(withActorKind(withPerson, 'system')).toEqual(state({ actorKind: 'system' }))
    expect(auditFiltersOf(state({ actorKind: 'customer', actorId: 'STF-1' }))).toEqual({
      actorKind: 'customer',
    })
  })

  it('knows when filters are set and clears them, keeping the selected event', () => {
    expect(hasAuditFilters(EMPTY_AUDIT_STATE)).toBe(false)
    expect(hasAuditFilters(state({ eventId: 'EVT-1' }))).toBe(false)
    expect(hasAuditFilters(state({ query: ' ' }))).toBe(false)
    expect(hasAuditFilters(state({ changesOnly: true }))).toBe(true)
    expect(clearAuditFilters(state({ caseId: 'CASE-1', eventId: 'EVT-1' }))).toEqual(
      state({ eventId: 'EVT-1' }),
    )
  })

  it('rejects a Hasta before Desde', () => {
    expect(dateRangeError({ fromDate: '2026-03-05', toDate: '2026-03-04' })).toBe(
      'Debe ser el mismo día de «Desde» o uno posterior.',
    )
    expect(dateRangeError({ fromDate: '2026-03-05', toDate: '2026-03-05' })).toBeNull()
    expect(dateRangeError({ fromDate: null, toDate: '2026-03-04' })).toBeNull()
  })
})

describe('rows', () => {
  it('labels and tones each kind of actor', () => {
    expect(actorRoleLabel('analyst')).toBe('Analista')
    expect(actorRoleLabel('supervisor')).toBe('Supervisión')
    expect(actorRoleLabel('admin')).toBe('Administración')
    expect(actorRoleLabel('customer')).toBe('Cliente')
    expect(actorRoleLabel('system')).toBe('Plataforma')
    expect(actorTone('supervisor')).toBe('warn')
    expect(actorTone('customer')).toBe('accent')
    expect(actorTone('system')).toBe('neutral')
    expect(actorName({ role: 'system', id: 'system', name: null })).toBe('Plataforma')
    expect(actorName({ role: 'customer', id: 'CUS-1', name: null })).toBe('CUS-1')
  })

  it('names the assistant by its badge alone (slice 19)', () => {
    expect(actorRoleLabel('assistant')).toBe('Asistente virtual')
    expect(actorTone('assistant')).toBe('neutral')
    expect(showsActorName('assistant')).toBe(false)
    expect(showsActorName('system')).toBe(false)
    expect(showsActorName('analyst')).toBe(true)
    expect(detailByline({ role: 'assistant', id: 'recepcion@1.0.0', name: null })).toEqual({
      name: 'Asistente virtual',
      role: null,
    })
  })

  it('writes times in the viewer zone', () => {
    expect(eventTime('2026-03-05T16:02:05Z')).toBe('11:02:05')
    expect(eventInstant('2026-03-05T16:02:05Z')).toBe('5 mar 2026, 11:02:05')
  })

  it('labels day separators Hoy, Ayer and the date', () => {
    expect(dayLabel('2026-03-05T14:00:00Z', NOW)).toBe('Hoy')
    expect(dayLabel('2026-03-05T04:00:00Z', NOW)).toBe('Ayer') // 23:00 on the 4th in Bogotá
    expect(dayLabel('2026-03-03T15:00:00Z', NOW)).toBe('3 mar')
    expect(dayLabel('2025-12-28T15:00:00Z', NOW)).toBe('28 dic 2025')
  })

  it('groups the newest-first log by day', () => {
    const groups = groupByDay(
      [
        makeAuditEvent({ id: 'EVT-3', occurredAt: '2026-03-05T15:00:00Z' }),
        makeAuditEvent({ id: 'EVT-2', occurredAt: '2026-03-05T06:00:00Z' }),
        makeAuditEvent({ id: 'EVT-1', occurredAt: '2026-03-04T15:00:00Z' }),
      ],
      NOW,
    )
    expect(groups.map((g) => [g.label, g.events.map((e) => e.id)])).toEqual([
      ['Hoy', ['EVT-3', 'EVT-2']],
      ['Ayer', ['EVT-1']],
    ])
  })

  it('keeps group keys unique when the same day heads two runs (non-monotonic times)', () => {
    const groups = groupByDay(
      [
        makeAuditEvent({ id: 'EVT-4', occurredAt: '2026-03-05T15:00:00Z' }),
        makeAuditEvent({ id: 'EVT-3', occurredAt: '2026-03-04T15:00:00Z' }),
        makeAuditEvent({ id: 'EVT-2', occurredAt: '2026-03-05T14:00:00Z' }),
        makeAuditEvent({ id: 'EVT-1', occurredAt: '2026-03-05T13:00:00Z' }),
      ],
      NOW,
    )
    expect(groups.map((g) => [g.day, g.label, g.events.map((e) => e.id)])).toEqual([
      ['2026-03-05', 'Hoy', ['EVT-4']],
      ['2026-03-04', 'Ayer', ['EVT-3']],
      ['2026-03-05', 'Hoy', ['EVT-2', 'EVT-1']],
    ])
    const keys = groups.map((g) => g.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('counts what is shown and words the empty log', () => {
    expect(shownCountLabel(1)).toBe('Mostrando 1 evento')
    expect(shownCountLabel(51)).toBe('Mostrando 51 eventos')
    expect(emptyLogCopy(false)).toBe('Todavía no hay eventos.')
    expect(emptyLogCopy(true)).toBe('Ningún evento coincide con estos filtros.')
  })
})

describe('detail aside', () => {
  it('writes the kicker and the byline', () => {
    const event = makeAuditEvent()
    // Separate parts, never joined with " · ".
    expect(detailKicker(event)).toEqual({ time: '11:02:05', family: 'ASIGNACIÓN' })
    expect(detailByline(event.actor)).toEqual({ name: 'Lucía Herrera', role: 'Supervisión' })
    expect(detailByline({ role: 'system', id: 'system', name: null })).toEqual({
      name: 'Plataforma',
      role: null,
    })
  })

  it('lists the payload, JSON for nested values, and flags the redacted text', () => {
    expect(
      payloadLines({ reason: 'manual', paused_override: false, n: 3, x: null, o: { a: 1 } }),
    ).toEqual([
      { key: 'reason', value: 'manual' },
      { key: 'paused_override', value: 'false' },
      { key: 'n', value: '3' },
      { key: 'x', value: 'null' },
      { key: 'o', value: '{"a":1}' },
    ])
    expect(hidesMessageText(makeAuditEvent())).toBe(false)
    expect(hidesMessageText(makeAuditEvent({ redactedFields: ['text'] }))).toBe(true)
    // Slice 7: a rating comment is redacted too, with its own note.
    expect(redactionNote(makeAuditEvent({ redactedFields: ['text'] }))).toBe(
      'El texto del mensaje no se muestra aquí: está en la conversación.',
    )
    expect(redactionNote(makeAuditEvent({ redactedFields: ['comment'] }))).toBe(
      'El comentario del cliente no se muestra aquí: está en el caso cerrado.',
    )
    expect(redactionNote(makeAuditEvent({ redactedFields: ['motive'] }))).toMatch(
      /^El motivo del escalamiento no se muestra aquí/,
    )
    expect(redactionNote(makeAuditEvent({ redactedFields: ['note'] }))).toMatch(
      /^La respuesta de supervisión no se muestra aquí/,
    )
    expect(redactionNote(makeAuditEvent({ redactedFields: [] }))).toBeNull()
  })
})
