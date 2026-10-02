import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FilterTile, FilterTileGroup } from './FilterTile'

const FILTERS = [
  { id: 'all', label: 'Todos', count: 9, tone: 'neutral' },
  { id: 'reply', label: 'Por responder', count: 3, tone: 'warn' },
  { id: 'live', label: 'En curso', count: 1, tone: 'success' },
] as const

function CaseFilters({ initial = 'all' }: { initial?: string | null }) {
  const [selected, setSelected] = useState<string | null>(initial)
  return (
    <FilterTileGroup aria-label="Filtrar casos">
      {FILTERS.map((f) => (
        <FilterTile
          key={f.id}
          label={f.label}
          count={f.count}
          tone={f.tone}
          selected={selected === f.id}
          onSelect={() => setSelected(f.id)}
        />
      ))}
    </FilterTileGroup>
  )
}

describe('FilterTile', () => {
  it('never ellipsises the label ("Por responder" reads whole at 320 px)', () => {
    render(<CaseFilters />)
    const label = screen.getByText('Por responder')
    // jsdom has no layout: the regression guard is the class contract (no
    // truncate, nowrap, tight tracking; measured at 1280 and 1440 in a browser).
    expect(label).not.toHaveClass('truncate')
    expect(label).toHaveClass('whitespace-nowrap', 'tracking-tight')
  })

  it('is a single-choice filter with aria-checked', async () => {
    const user = userEvent.setup()
    render(<CaseFilters />)
    expect(screen.getByRole('radiogroup', { name: 'Filtrar casos' })).toBeInTheDocument()
    const all = screen.getByRole('radio', { name: '9 Todos' })
    const reply = screen.getByRole('radio', { name: '3 Por responder' })
    expect(all).toBeChecked()
    expect(reply).not.toBeChecked()

    await user.click(reply)
    expect(reply).toBeChecked()
    expect(all).not.toBeChecked()
  })

  it('moves and selects with the arrow keys (any direction)', async () => {
    const user = userEvent.setup()
    render(<CaseFilters />)
    await user.tab()
    expect(screen.getByRole('radio', { name: '9 Todos' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    const reply = screen.getByRole('radio', { name: '3 Por responder' })
    expect(reply).toHaveFocus()
    expect(reply).toBeChecked()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: '1 En curso' })).toBeChecked()
    await user.keyboard('{ArrowUp}')
    expect(reply).toBeChecked()
  })

  it('keeps the group reachable with Tab when nothing is selected', async () => {
    const user = userEvent.setup()
    render(<CaseFilters initial={null} />)
    await user.tab()
    expect(screen.getByRole('radio', { name: '9 Todos' })).toHaveFocus()
  })
})
