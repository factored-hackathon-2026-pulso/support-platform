import { describe, expect, it } from 'vitest'
import {
  emptyWorkspaceCopy,
  firstSelectableCase,
  isCustomerFileOpen,
  nextCaseAfterClose,
  parseWorkspaceSearch,
  toWorkspaceSearch,
  type WorkspaceUrlState,
} from './model'

const defaults: WorkspaceUrlState = {
  caseId: null,
  filter: null,
  query: '',
  listCollapsed: false,
  customerFile: false,
  history: null,
}

describe('parseWorkspaceSearch', () => {
  it('reads every param', () => {
    const params = new URLSearchParams(
      'caso=CASE-1&estado=cerrados&q=Marcela&lista=contraida&ficha=1&historial=lista',
    )
    expect(parseWorkspaceSearch(params)).toEqual({
      caseId: 'CASE-1',
      filter: 'closed',
      query: 'Marcela',
      listCollapsed: true,
      customerFile: true,
      history: 'lista',
    })
  })

  it('opens "Ficha del cliente" with ficha=1 or an old historial deep link', () => {
    expect(isCustomerFileOpen(parseWorkspaceSearch(new URLSearchParams('caso=C&ficha=1')))).toBe(
      true,
    )
    expect(
      isCustomerFileOpen(parseWorkspaceSearch(new URLSearchParams('caso=C&historial=lista'))),
    ).toBe(true)
    expect(isCustomerFileOpen(parseWorkspaceSearch(new URLSearchParams('caso=C')))).toBe(false)
  })

  it('opens "Casos anteriores" on a past case', () => {
    const params = new URLSearchParams('caso=CASE-108&historial=CASE-110')
    expect(parseWorkspaceSearch(params).history).toBe('CASE-110')
  })

  it('falls back to the defaults for absent, unknown and removed values', () => {
    expect(parseWorkspaceSearch(new URLSearchParams())).toEqual(defaults)
    expect(
      parseWorkspaceSearch(
        new URLSearchParams(
          'caso=&estado=por-llamar&lista=1&ficha=si&historial=%20&panel=cliente&apoyo=contraido',
        ),
      ),
    ).toEqual(defaults)
  })
})

describe('toWorkspaceSearch', () => {
  it('leaves the defaults out of the URL', () => {
    expect(toWorkspaceSearch(defaults).toString()).toBe('')
  })

  it('round-trips through the parser, without panel or apoyo', () => {
    const state: WorkspaceUrlState = {
      caseId: 'CASE-00000000000000000000000108',
      filter: 'waiting',
      query: 'Joaquín',
      listCollapsed: true,
      customerFile: true,
      history: 'CASE-00000000000000000000000110',
    }
    const params = toWorkspaceSearch(state)
    expect(params.get('ficha')).toBe('1')
    expect(params.get('estado')).toBe('esperando')
    expect(params.get('historial')).toBe('CASE-00000000000000000000000110')
    expect(params.has('panel')).toBe(false)
    expect(params.has('apoyo')).toBe(false)
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

describe('emptyWorkspaceCopy', () => {
  it('says there is nothing open, and explains the pause', () => {
    expect(emptyWorkspaceCopy(false)).toEqual({
      title: 'No tienes casos abiertos',
      description: 'Estás disponible. Cuando un cliente escriba y te corresponda, aparece aquí.',
    })
    expect(emptyWorkspaceCopy(true)).toEqual({
      title: 'No tienes casos abiertos',
      description:
        'Estás en pausa: no te llegan casos nuevos. Vuelve a disponible para recibir el siguiente.',
    })
  })
})
