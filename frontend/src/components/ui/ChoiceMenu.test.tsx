import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChoiceMenu } from './ChoiceMenu'

type Level = 'none' | 'critical' | 'high' | 'medium' | 'low'

const OPTIONS: { value: Level; label: string }[] = [
  { value: 'none', label: 'Sin prioridad' },
  { value: 'critical', label: 'Crítica' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Media' },
  { value: 'low', label: 'Baja' },
]

function Harness({ onChange }: { onChange: (value: Level) => void }) {
  const [value, setValue] = useState<Level>('medium')
  return (
    <>
      <ChoiceMenu
        value={value}
        options={OPTIONS}
        onChange={(next) => {
          onChange(next)
          setValue(next)
        }}
        triggerLabel={`Prioridad: ${value}`}
        menuLabel="Prioridad"
      >
        {value}
      </ChoiceMenu>
      <button type="button">Después</button>
    </>
  )
}

function setup(onChange = vi.fn<(value: Level) => void>()) {
  const user = userEvent.setup()
  render(<Harness onChange={onChange} />)
  return { user, onChange, trigger: screen.getByRole('button', { name: 'Prioridad: medium' }) }
}

const focusedItem = () => document.activeElement?.textContent

describe('ChoiceMenu (menu button + menuitemradio)', () => {
  it('opens on the checked option and names everything', async () => {
    const { user, trigger } = setup()
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Prioridad' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', menu.id)
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Sin prioridad', 'false'],
      ['Crítica', 'false'],
      ['Alta', 'false'],
      ['Media', 'true'],
      ['Baja', 'false'],
    ])
    expect(screen.getByRole('menuitemradio', { name: 'Media' })).toHaveFocus()
    // One Tab stop inside the menu (roving focus).
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1)
  })

  it('moves with the arrows (wrapping), Home, End and a letter, and picks with Enter', async () => {
    const { user, trigger, onChange } = setup()
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(focusedItem()).toBe('Media')
    await user.keyboard('{ArrowDown}')
    expect(focusedItem()).toBe('Baja')
    await user.keyboard('{ArrowDown}')
    expect(focusedItem()).toBe('Sin prioridad')
    await user.keyboard('{ArrowUp}')
    expect(focusedItem()).toBe('Baja')
    await user.keyboard('{Home}')
    expect(focusedItem()).toBe('Sin prioridad')
    await user.keyboard('{End}')
    expect(focusedItem()).toBe('Baja')
    await user.keyboard('a')
    expect(focusedItem()).toBe('Alta')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('high')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prioridad: high' })).toHaveFocus()
  })

  it('opens on the first or last option from the arrows and picks with Space', async () => {
    const { user, trigger, onChange } = setup()
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(focusedItem()).toBe('Sin prioridad')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(focusedItem()).toBe('Baja')
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith('low')
  })

  it('does nothing when the checked option is picked again', async () => {
    const { user, trigger, onChange } = setup()
    await user.click(trigger)
    await user.click(screen.getByRole('menuitemradio', { name: 'Media' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes with Tab and with a click outside', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(trigger)
    await user.click(trigger) // the trigger toggles it
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps Escape for itself (a panel around it stays open)', async () => {
    const outer = vi.fn<() => void>()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) outer()
    }
    document.addEventListener('keydown', onKeyDown)
    const user = userEvent.setup()
    render(
      <ChoiceMenu
        value="none"
        options={OPTIONS}
        onChange={vi.fn<(value: Level) => void>()}
        triggerLabel="Prioridad"
        menuLabel="Prioridad"
      >
        x
      </ChoiceMenu>,
    )
    await user.click(screen.getByRole('button', { name: 'Prioridad' }))
    await user.keyboard('{Escape}')
    expect(outer).not.toHaveBeenCalled()
    document.removeEventListener('keydown', onKeyDown)
  })
})
