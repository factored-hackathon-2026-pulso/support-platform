import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Sheet } from './Sheet'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Casos anteriores (2)
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Casos anteriores de Patricia"
        description="Conversaciones que tuvo con el equipo. Solo lectura."
      >
        <button type="button">Primer caso</button>
      </Sheet>
    </>
  )
}

describe('Sheet', () => {
  it('is a titled, described modal that returns the focus to its trigger', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Casos anteriores (2)' })
    await user.click(trigger)
    const sheet = screen.getByRole('dialog', { name: 'Casos anteriores de Patricia' })
    expect(sheet).toHaveAccessibleDescription(
      'Conversaciones que tuvo con el equipo. Solo lectura.',
    )
    expect(sheet).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
