import { describe, expect, it } from 'vitest'
import { EMPTY_AUDIT_STATE } from './model'
import { parseAuditSearch, toAuditSearch } from './url'

describe('URL state of Auditoría', () => {
  it('parses and serializes every filter', () => {
    const search =
      'actor=staff&person=STF-1&case=CASE-114&type=assignment&from=2026-03-01&to=2026-03-05&q=114&changes=1&event=EVT-9'
    const state = parseAuditSearch(new URLSearchParams(search))
    expect(state).toEqual({
      actorKind: 'staff',
      actorId: 'STF-1',
      caseId: 'CASE-114',
      family: 'assignment',
      fromDate: '2026-03-01',
      toDate: '2026-03-05',
      query: '114',
      changesOnly: true,
      eventId: 'EVT-9',
    })
    expect(toAuditSearch(state).toString()).toBe(search)
  })

  it('reads the API values of every family and kind', () => {
    expect(parseAuditSearch(new URLSearchParams('type=escalation')).family).toBe('escalation')
    expect(parseAuditSearch(new URLSearchParams('type=administration')).family).toBe(
      'administration',
    )
    expect(parseAuditSearch(new URLSearchParams('actor=customer')).actorKind).toBe('customer')
    expect(parseAuditSearch(new URLSearchParams('actor=system')).actorKind).toBe('system')
  })

  it('falls back on unknown values (the old Spanish ones too) and leaves defaults out', () => {
    const state = parseAuditSearch(
      new URLSearchParams('actor=agents&type=arbol&from=2026-02-30&to=ayer&changes=si'),
    )
    expect(state).toEqual(EMPTY_AUDIT_STATE)
    expect(toAuditSearch(state).toString()).toBe('')
    expect(parseAuditSearch(new URLSearchParams('quien=equipo&tipo=ciclo'))).toEqual(
      EMPTY_AUDIT_STATE,
    )
    expect(parseAuditSearch(new URLSearchParams(`q=${'x'.repeat(100)}`)).query).toHaveLength(80)
  })
})
