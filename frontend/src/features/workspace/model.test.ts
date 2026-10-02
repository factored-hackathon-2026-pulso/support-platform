import { describe, expect, it } from 'vitest'
import {
  customerHeaderId,
  customerHeaderLine,
  emptyWorkspaceCopy,
  firstSelectableCase,
  formatMonthYear,
  nextCaseAfterClose,
  parseWorkspaceSearch,
  toWorkspaceSearch,
  type WorkspaceUrlState,
} from './model'

const defaults: WorkspaceUrlState = {
  caseId: null,
  filter: null,
  query: '',
  panelTab: 'copiloto',
  panelCollapsed: false,
  listCollapsed: false,
}

describe('parseWorkspaceSearch', () => {
  it('reads every param', () => {
    const params = new URLSearchParams(
      'caso=CASE-1&estado=por-llamar&q=Marcela&panel=cliente&lista=contraida&apoyo=contraido',
    )
    expect(parseWorkspaceSearch(params)).toEqual({
      caseId: 'CASE-1',
      filter: 'to_call',
      query: 'Marcela',
      panelTab: 'cliente',
      panelCollapsed: true,
      listCollapsed: true,
    })
  })

  it('falls back to the defaults for absent or unknown values', () => {
    expect(parseWorkspaceSearch(new URLSearchParams())).toEqual(defaults)
    expect(
      parseWorkspaceSearch(new URLSearchParams('caso=&estado=x&panel=x&lista=1&apoyo=si')),
    ).toEqual(defaults)
  })
})

describe('toWorkspaceSearch', () => {
  it('leaves the defaults out of the URL', () => {
    expect(toWorkspaceSearch(defaults).toString()).toBe('')
  })

  it('round-trips through the parser', () => {
    const state: WorkspaceUrlState = {
      caseId: 'CASE-00000000000000000000000101',
      filter: 'waiting',
      query: 'Joaquín',
      panelTab: 'herramientas',
      panelCollapsed: true,
      listCollapsed: true,
    }
    const params = toWorkspaceSearch(state)
    expect(params.get('estado')).toBe('en-espera')
    expect(params.get('panel')).toBe('herramientas')
    expect(parseWorkspaceSearch(new URLSearchParams(params.toString()))).toEqual(state)
  })
})

describe('case selection', () => {
  const items = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]

  it('auto-selects the first case not closed here', () => {
    expect(firstSelectableCase(items)).toBe('A')
    expect(firstSelectableCase(items, new Set(['A']))).toBe('B')
    expect(firstSelectableCase([])).toBeNull()
  })

  it('after closing, goes to the case below, else above, else none', () => {
    expect(nextCaseAfterClose(items, 'B')).toBe('C')
    expect(nextCaseAfterClose(items, 'C')).toBe('B')
    expect(nextCaseAfterClose(items, 'C', new Set(['B']))).toBe('A')
    expect(nextCaseAfterClose([{ id: 'A' }], 'A')).toBeNull()
    expect(nextCaseAfterClose(items, 'Z')).toBe('A')
  })
})

describe('client header', () => {
  const customer = {
    id: 'CUS-00000000000000000000001001',
    segment: 'Plus',
    customerSince: '2019-02-01',
    city: 'Barranquilla',
    country: 'CO' as const,
    documentType: 'CE',
  }

  it('formats the calendar month without a time-zone shift', () => {
    expect(formatMonthYear('2019-02-01')).toBe('feb 2019')
    expect(formatMonthYear('2020-01-31')).toBe('ene 2020')
  })

  it('builds the header lines', () => {
    expect(customerHeaderLine(customer)).toBe(
      'Plus · cliente desde feb 2019 · Barranquilla, Colombia',
    )
    expect(customerHeaderId(customer)).toBe('CUS-00000000000000000000001001 · CE')
  })
})

describe('emptyWorkspaceCopy', () => {
  it('uses the canvas copy, and explains the pause', () => {
    expect(emptyWorkspaceCopy(false)).toEqual({
      title: 'No tienes contactos abiertos',
      description:
        'Estás disponible. Cuando un agente escale un contacto que te corresponde, aparece aquí.',
    })
    expect(emptyWorkspaceCopy(true).description).toMatch(/^Estás en pausa/)
  })
})
