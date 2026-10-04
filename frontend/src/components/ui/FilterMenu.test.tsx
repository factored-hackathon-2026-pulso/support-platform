import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterChips, FilterMenu } from './FilterMenu'
import {
  activeFilterChips,
  countSelected,
  toggleFilter,
  type FilterGroup,
  type FilterSelection,
} from './filter-selection'

const GROUPS: FilterGroup[] = [
  {
    key: 'estado',
    legend: 'Estado',
    options: [
      { value: 'new', label: 'Nuevo', count: 2 },
      { value: 'to_reply', label: 'Por responder', count: 3 },
    ],
  },
  { key: 'idioma', legend: 'Idioma', options: [{ value: 'pt', label: 'Portugués' }] },
]

function Harness({ initial = {} }: { initial?: FilterSelection }) {
  const [selection, setSelection] = useState<FilterSelection>(initial)
  const chips = activeFilterChips(GROUPS, selection)
  return (
    <div>
      <p>outside</p>
      <FilterMenu
        groups={GROUPS}
        selection={selection}
        onToggle={(group, value) => setSelection((s) => toggleFilter(s, group, value))}
        onClear={() => setSelection({})}
      />
      <FilterChips
        chips={chips}
        onRemove={(group, value) => setSelection((s) => toggleFilter(s, group, value))}
      />
    </div>
  )
}

describe('FilterMenu', () => {
  it('opens a panel of checkbox groups with counts and closes with Listo', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const button = screen.getByRole('button', { name: 'Filtros' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const estado = screen.getByRole('group', { name: 'Estado' })
    expect(estado).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Nuevo 2' })).toHaveFocus()
    expect(screen.getByRole('checkbox', { name: 'Portugués' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    expect(screen.queryByRole('group', { name: 'Estado' })).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('checks options into removable chips and counts them on the button', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Filtros' }))
    await user.click(screen.getByRole('checkbox', { name: 'Por responder 3' }))
    await user.click(screen.getByRole('checkbox', { name: 'Portugués' }))
    expect(screen.getByRole('button', { name: 'Filtros 2 activos' })).toBeInTheDocument()
    const chips = screen.getByRole('group', { name: 'Filtros activos' })
    expect(chips).toHaveTextContent('Por responder')
    await user.click(screen.getByRole('button', { name: 'Quitar filtro Portugués' }))
    expect(screen.queryByRole('button', { name: 'Quitar filtro Portugués' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Filtros 1 activos' })).toBeInTheDocument()
  })

  it('clears every filter and closes on Escape or a click outside', async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ estado: ['new'] }} />)
    await user.click(screen.getByRole('button', { name: 'Filtros 1 activos' }))
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(screen.queryByRole('group', { name: 'Filtros activos' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Estado' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Filtros' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Filtros' }))
    await user.click(screen.getByText('outside'))
    expect(screen.queryByRole('group', { name: 'Estado' })).toBeNull()
  })

  it('pure helpers', () => {
    const selection = toggleFilter({}, 'estado', 'new')
    expect(selection).toEqual({ estado: ['new'] })
    expect(toggleFilter(selection, 'estado', 'new')).toEqual({ estado: [] })
    expect(countSelected({ estado: ['new', 'to_reply'], idioma: ['pt'] })).toBe(3)
    expect(activeFilterChips(GROUPS, { idioma: ['pt'], estado: ['to_reply'] })).toEqual([
      { groupKey: 'estado', value: 'to_reply', label: 'Por responder' },
      { groupKey: 'idioma', value: 'pt', label: 'Portugués' },
    ])
  })
})
