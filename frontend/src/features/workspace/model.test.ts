import { describe, expect, it } from 'vitest'
import { emptyWorkspaceCopy, firstSelectableCase, nextCaseAfterClose } from './model'

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
