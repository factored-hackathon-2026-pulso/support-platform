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

  it('names an option by its label and describes it with its description', () => {
    render(
      <RadioGroup
        label="¿A quién?"
        value={null}
        onValueChange={() => {}}
        options={[
          { value: 'a', label: 'Daniela Ríos', description: 'Disponible · 2 abiertos' },
          {
            value: 'b',
            label: 'Julián Ortega',
            description: 'No habla portugués (regla 3)',
            disabled: true,
          },
        ]}
      />,
    )
    const daniela = screen.getByRole('radio', { name: 'Daniela Ríos' })
    expect(daniela).toHaveAccessibleDescription('Disponible · 2 abiertos')
    const julian = screen.getByRole('radio', { name: 'Julián Ortega' })
    expect(julian).toBeDisabled()
    expect(julian).toHaveAccessibleDescription('No habla portugués (regla 3)')
  })
})

describe('RadioGroup · cards', () => {
  function Cards() {
    const [value, setValue] = useState<'a' | 'b' | 'c' | null>(null)
    return (
      <RadioGroup<'a' | 'b' | 'c'>
        label="Motivo"
        variant="cards"
        columns={2}
        value={value}
        onValueChange={setValue}
        options={[
          { value: 'a', label: 'Uno', description: 'El primero.', tone: 'success', icon: <i>1</i> },
          { value: 'b', label: 'Dos', description: 'El segundo.', tone: 'accent' },
          { value: 'c', label: 'Tres', description: 'Ocupa la fila.', wide: true },
        ]}
      />
    )
  }

  it('draws selectable cards with a hidden native radio, in two columns', async () => {
    const user = userEvent.setup()
    render(<Cards />)
    const one = screen.getByRole('radio', { name: 'Uno' })
    expect(one).toHaveAccessibleDescription('El primero.')
    expect(one).toHaveClass('sr-only')
    expect(one.closest('label')).toHaveClass('has-focus-visible:outline-2')
    expect(one.closest('label')).toHaveTextContent('1UnoEl primero.')
    expect(screen.getByRole('radio', { name: 'Tres' }).closest('label')).toHaveClass('col-span-2')
    expect(one.closest('div')).toHaveClass('grid-cols-2')

    await user.click(screen.getByText('Dos'))
    const two = screen.getByRole('radio', { name: 'Dos' })
    expect(two).toBeChecked()
    expect(two.closest('label')).toHaveClass('border-accent-strong', 'bg-accent-soft')
    // Arrow keys move and select, like the list.
    two.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Tres' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Tres' }).closest('label')).toHaveClass(
      'border-muted',
      'bg-canvas',
    )
  })
})
