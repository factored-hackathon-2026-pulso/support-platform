import { describe, expect, it } from 'vitest'
import { workspacePath } from '@/app/paths'
import {
  isCustomerFileOpen,
  openPanel,
  parsePanel,
  parseWorkspaceSearch,
  toWorkspaceSearch,
  type WorkspaceUrlState,
} from './url'

const defaults: WorkspaceUrlState = {
  caseId: null,
  filter: null,
  query: '',
  listCollapsed: false,
  panel: null,
  history: null,
}

describe('parseWorkspaceSearch', () => {
  it('reads every param', () => {
    const params = new URLSearchParams(
      'case=CASE-1&status=closed&q=Marcela&list=collapsed&panel=customer&previous=list',
    )
    expect(parseWorkspaceSearch(params)).toEqual({
      caseId: 'CASE-1',
      filter: 'closed',
      query: 'Marcela',
      listCollapsed: true,
      panel: 'customer',
      history: 'list',
    })
  })

  it('reads the handoff tab (slice 19) and keeps "Casos anteriores" on the customer tab', () => {
    const handoff = parseWorkspaceSearch(new URLSearchParams('case=C&panel=handoff'))
    expect(handoff.panel).toBe('handoff')
    expect(openPanel(handoff)).toBe('handoff')
    expect(isCustomerFileOpen(handoff)).toBe(false)
    expect(
      openPanel(parseWorkspaceSearch(new URLSearchParams('panel=handoff&previous=list'))),
    ).toBe('customer')
  })

  it('reads the copilot and tools tabs (slice 20) and round-trips them', () => {
    for (const panel of ['copilot', 'tools'] as const) {
      const state = parseWorkspaceSearch(new URLSearchParams(`case=C&panel=${panel}`))
      expect(state.panel).toBe(panel)
      expect(openPanel(state)).toBe(panel)
      expect(toWorkspaceSearch(state).get('panel')).toBe(panel)
    }
    expect(parseWorkspaceSearch(new URLSearchParams('panel=copiloto')).panel).toBeNull()
    expect(parsePanel('tools')).toBe('tools')
    expect(parsePanel('herramientas')).toBeNull()
  })

  it('opens "Ficha del cliente" with panel=customer or a previous deep link', () => {
    expect(
      isCustomerFileOpen(parseWorkspaceSearch(new URLSearchParams('case=C&panel=customer'))),
    ).toBe(true)
    expect(
      isCustomerFileOpen(parseWorkspaceSearch(new URLSearchParams('case=C&previous=list'))),
    ).toBe(true)
    expect(isCustomerFileOpen(parseWorkspaceSearch(new URLSearchParams('case=C')))).toBe(false)
  })

  it('opens "Casos anteriores" on a past case', () => {
    const params = new URLSearchParams('case=CASE-108&previous=CASE-110')
    expect(parseWorkspaceSearch(params).history).toBe('CASE-110')
  })

  it('falls back to the defaults for absent and unknown values', () => {
    expect(parseWorkspaceSearch(new URLSearchParams())).toEqual(defaults)
    expect(
      parseWorkspaceSearch(
        new URLSearchParams('case=&status=queued&list=1&panel=support&previous=%20'),
      ),
    ).toEqual(defaults)
  })
})

describe('toWorkspaceSearch', () => {
  it('leaves the defaults out of the URL', () => {
    expect(toWorkspaceSearch(defaults).toString()).toBe('')
  })

  it('round-trips through the parser', () => {
    const state: WorkspaceUrlState = {
      caseId: 'CASE-00000000000000000000000108',
      filter: 'waiting',
      query: 'Joaquín',
      listCollapsed: true,
      panel: 'customer',
      history: 'CASE-00000000000000000000000110',
    }
    const params = toWorkspaceSearch(state)
    expect(params.get('panel')).toBe('customer')
    expect(params.get('status')).toBe('waiting')
    expect(params.get('previous')).toBe('CASE-00000000000000000000000110')
    expect(parseWorkspaceSearch(new URLSearchParams(params.toString()))).toEqual(state)
  })
})

describe('workspacePath (app/paths)', () => {
  it('builds links this screen reads back', () => {
    const url = new URL(workspacePath({ caseId: 'CASE-1', status: 'to_reply' }), 'http://app')
    expect(url.pathname).toBe('/analyst/cases')
    expect(parseWorkspaceSearch(url.searchParams)).toMatchObject({
      caseId: 'CASE-1',
      filter: 'to_reply',
    })
  })
})
