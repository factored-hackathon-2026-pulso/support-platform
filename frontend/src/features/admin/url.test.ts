import { describe, expect, it } from 'vitest'
import { EMPTY_USERS_STATE } from './model'
import { parseTeamsSearch, parseUsersSearch, toTeamsSearch, toUsersSearch } from './url'

describe('URL state of Usuarios y roles', () => {
  it('parses and serializes the users screen with several values per group', () => {
    const params = new URLSearchParams(
      'role=analyst,supervisor&status=locked,invited,inactive&team=TEAM-1,TEAM-2&language=pt&q=mar&person=STF-1&new=1',
    )
    const state = parseUsersSearch(params)
    expect(state).toEqual({
      roles: ['analyst', 'supervisor'],
      statuses: ['locked', 'invited', 'inactive'],
      teamIds: ['TEAM-1', 'TEAM-2'],
      languages: ['pt'],
      query: 'mar',
      staffId: 'STF-1',
      create: true,
    })
    expect(toUsersSearch(state).toString()).toBe(params.toString())
  })

  it('reads single values and drops unknown ones (the old Spanish ones too)', () => {
    expect(
      parseUsersSearch(new URLSearchParams('role=supervisor&status=active&language=es')),
    ).toEqual({
      ...EMPTY_USERS_STATE,
      roles: ['supervisor'],
      statuses: ['active'],
      languages: ['es'],
    })
    const state = parseUsersSearch(
      new URLSearchParams(
        'role=automation,supervisoras&status=vacation,all&language=en&team=,%20&person=%20&new=yes',
      ),
    )
    expect(state).toEqual(EMPTY_USERS_STATE)
    expect(toUsersSearch(state).toString()).toBe('')
    expect(parseUsersSearch(new URLSearchParams('rol=analistas&persona=STF-1'))).toEqual(
      EMPTY_USERS_STATE,
    )
    expect(parseUsersSearch(new URLSearchParams('language=pt,es,pt')).languages).toEqual([
      'es',
      'pt',
    ])
    expect(parseUsersSearch(new URLSearchParams(`q=${'x'.repeat(100)}`)).query).toHaveLength(80)
  })
})

describe('URL state of Equipos', () => {
  it('parses and serializes the teams screen', () => {
    const state = parseTeamsSearch(new URLSearchParams('status=inactive&team=TEAM-4&new=1'))
    expect(state).toEqual({ statuses: ['inactive'], teamId: 'TEAM-4', create: true })
    expect(toTeamsSearch(state).toString()).toBe('status=inactive&team=TEAM-4&new=1')
  })

  it('falls back to the active teams; "all" checks nothing', () => {
    expect(parseTeamsSearch(new URLSearchParams('status=archived'))).toEqual({
      statuses: ['active'],
      teamId: null,
      create: false,
    })
    expect(parseTeamsSearch(new URLSearchParams('status=all')).statuses).toEqual([])
    expect(parseTeamsSearch(new URLSearchParams('status=inactive,active')).statuses).toEqual([
      'active',
      'inactive',
    ])
    expect(toTeamsSearch({ statuses: ['active'], teamId: null, create: false }).toString()).toBe('')
    expect(toTeamsSearch({ statuses: [], teamId: null, create: false }).toString()).toBe(
      'status=all',
    )
    expect(
      toTeamsSearch({ statuses: ['inactive', 'active'], teamId: null, create: false }).get(
        'status',
      ),
    ).toBe('active,inactive')
  })
})
