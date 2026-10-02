import { createRef, useState, type Ref } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CodeInput, type CodeInputHandle } from './CodeInput'

function Harness({ initial = '', handle }: { initial?: string; handle?: Ref<CodeInputHandle> }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <CodeInput
        label="Código de 6 dígitos"
        value={value}
        onChange={setValue}
        describedBy="code-hint"
        ref={handle}
      />
      <span id="code-hint">Escribe los 6 dígitos.</span>
      <output>{value}</output>
    </>
  )
}

describe('CodeInput', () => {
  it('renders one labelled box per digit inside a named group', () => {
    render(<Harness />)
    expect(screen.getByRole('group', { name: 'Código de 6 dígitos' })).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(6)
    expect(screen.getByRole('textbox', { name: 'Dígito 1' })).toHaveAttribute(
      'autocomplete',
      'one-time-code',
    )
    // The hint / error describes every box, not only the group.
    for (const box of screen.getAllByRole('textbox')) {
      expect(box).toHaveAccessibleDescription('Escribe los 6 dígitos.')
    }
  })

  it('moves focus on demand: the first empty box, or a given one', () => {
    const handle = createRef<CodeInputHandle>()
    render(<Harness initial="12" handle={handle} />)
    act(() => handle.current?.focus())
    expect(screen.getByRole('textbox', { name: 'Dígito 3' })).toHaveFocus()
    act(() => handle.current?.focus(0))
    expect(screen.getByRole('textbox', { name: 'Dígito 1' })).toHaveFocus()
  })

  it('advances while typing and goes back with Backspace', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('textbox', { name: 'Dígito 1' }))
    await user.keyboard('482')
    expect(screen.getByRole('status')).toHaveTextContent('482')
    expect(screen.getByRole('textbox', { name: 'Dígito 4' })).toHaveFocus()

    await user.keyboard('{Backspace}')
    expect(screen.getByRole('status')).toHaveTextContent(/^48$/)
    expect(screen.getByRole('textbox', { name: 'Dígito 3' })).toHaveFocus()
  })

  it('fills all boxes on paste', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('textbox', { name: 'Dígito 1' }))
    await user.paste('000000')
    expect(screen.getByRole('status')).toHaveTextContent('000000')
  })
})
