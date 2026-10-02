import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

const OPTIONS = [
  { value: 'actions', label: 'Acciones', count: 3 },
  { value: 'queries', label: 'Consultas', count: 4 },
  { value: 'done', label: 'Hechas', count: 2 },
]

describe('SegmentedControl', () => {
  it('is a labelled group of radios with one checked', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn<(value: string) => void>()
    render(
      <SegmentedControl
        label="Tipo de herramienta"
        options={OPTIONS}
        onValueChange={onValueChange}
      />,
    )
    expect(screen.getByRole('group', { name: 'Tipo de herramienta' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Acciones 3' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Consultas 4' }))
    expect(screen.getByRole('radio', { name: 'Consultas 4' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Acciones 3' })).not.toBeChecked()
    expect(onValueChange).toHaveBeenCalledWith('queries')
  })
})
