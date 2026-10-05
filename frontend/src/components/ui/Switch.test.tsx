import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Switch } from './Switch'

function Harness({ onChange }: { onChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(false)
  return (
    <Switch
      checked={checked}
      onCheckedChange={(next) => {
        setChecked(next)
        onChange?.(next)
      }}
      aria-label="Funciones de IA"
    />
  )
}

describe('Switch', () => {
  it('is a named switch that toggles with a click, Space and Enter', async () => {
    const onChange = vi.fn<(checked: boolean) => void>()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)
    const control = screen.getByRole('switch', { name: 'Funciones de IA' })
    expect(control).toHaveAttribute('aria-checked', 'false')
    await user.click(control)
    expect(control).toHaveAttribute('aria-checked', 'true')
    control.focus()
    await user.keyboard(' ')
    expect(control).toHaveAttribute('aria-checked', 'false')
    await user.keyboard('{Enter}')
    expect(control).toHaveAttribute('aria-checked', 'true')
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([true, false, true])
  })

  it('does nothing while disabled', async () => {
    const onChange = vi.fn<(checked: boolean) => void>()
    const user = userEvent.setup()
    render(<Switch checked onCheckedChange={onChange} disabled aria-label="Funciones de IA" />)
    await user.click(screen.getByRole('switch', { name: 'Funciones de IA' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
