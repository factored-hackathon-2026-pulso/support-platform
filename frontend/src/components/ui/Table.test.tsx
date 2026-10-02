import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TBody, TCell, TH, THead, TRow, TRowSelect, Table } from './Table'

const PEOPLE = [
  { id: 'a', name: 'Laura Gómez', open: 4 },
  { id: 'b', name: 'Mateo Ruiz', open: 2 },
]

function Team() {
  const [selected, setSelected] = useState('a')
  return (
    <Table aria-label="Analistas">
      <THead>
        <TRow>
          <TH>Nombre</TH>
          <TH align="right">Abiertos</TH>
        </TRow>
      </THead>
      <TBody>
        {PEOPLE.map((p) => (
          <TRow key={p.id} selected={selected === p.id} onSelect={() => setSelected(p.id)}>
            <TCell>
              <TRowSelect>{p.name}</TRowSelect>
            </TCell>
            <TCell align="right">{p.open}</TCell>
          </TRow>
        ))}
      </TBody>
    </Table>
  )
}

describe('Table', () => {
  it('stays a native table and marks the current row on its select button', () => {
    render(<Team />)
    const table = screen.getByRole('table', { name: 'Analistas' })
    expect(table).not.toHaveAttribute('role')
    expect(within(table).queryByRole('row', { selected: true })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Laura Gómez' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('selects with the keyboard (one Tab stop per row) or a click on the row', async () => {
    const user = userEvent.setup()
    render(<Team />)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Laura Gómez' })).toHaveFocus()
    await user.tab()
    const mateo = screen.getByRole('button', { name: 'Mateo Ruiz' })
    expect(mateo).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(mateo).toHaveAttribute('aria-current', 'true')

    await user.click(screen.getByText('4'))
    expect(screen.getByRole('button', { name: 'Laura Gómez' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })
})
