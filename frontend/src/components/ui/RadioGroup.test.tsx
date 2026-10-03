import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RadioGroup } from './RadioGroup'

const OPTIONS = [
  { value: 'resolved', label: 'Resuelto' },
  { value: 'duplicate', label: 'Duplicado' },
  { value: 'other', label: 'Otro' },
] as const

type Value = (typeof OPTIONS)[number]['value']

function Harness({ error, onChange }: { error?: string; onChange?: (value: Value) => void }) {
  const [value, setValue] = useState<Value | null>(null)
  return (
    <RadioGroup<Value>
      label="Motivo"
      required
      options={OPTIONS}
      value={value}
      error={error}
      onValueChange={(next) => {
        onChange?.(next)
        setValue(next)
      }}
    />
  )
}

describe('RadioGroup', () => {
  it('is a labelled, required radiogroup of native radios', () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: /Motivo/ })
    expect(group).toHaveAttribute('aria-required', 'true')
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Resuelto' })).not.toBeChecked()
  })

  it('keeps one Tab stop: the first radio while none is checked, then the checked one', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.tab()
    expect(screen.getByRole('radio', { name: 'Resuelto' })).toHaveFocus()
    await user.click(screen.getByRole('radio', { name: 'Otro' }))
    expect(screen.getByRole('radio', { name: 'Otro' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Resuelto' })).toHaveAttribute('tabindex', '-1')
  })

  it('moves and selects with the arrow keys, wrapping around', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: Value) => void>()
    render(<Harness onChange={onChange} />)
    await user.tab()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Duplicado' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'Duplicado' })).toBeChecked()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Resuelto' })).toBeChecked()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('radio', { name: 'Otro' })).toBeChecked()
    expect(onChange).toHaveBeenLastCalledWith('other')
  })

  it('describes the group with its error and marks it invalid', () => {
    render(<Harness error="Elige un motivo." />)
    const group = screen.getByRole('radiogroup', { name: /Motivo/ })
    expect(group).toHaveAttribute('aria-invalid', 'true')
    expect(group).toHaveAccessibleDescription('Elige un motivo.')
  })
})
