import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Fact, FactList } from './Fact'
import { spokenFact } from './fact-icons'

describe('Fact / FactList', () => {
  it('draws one short fact with its icon, an optional screen-reader label and a tag', () => {
    render(<Fact icon="languages" text="Portugués" label="Idioma" tag="Regla 3" tone="accent" />)
    const text = screen.getByText('Portugués')
    expect(text.parentElement).toHaveTextContent('Idioma: PortuguésRegla 3')
    expect(text.parentElement).toHaveClass('text-accent')
    expect(text.parentElement?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows only the icon for a secondary fact, with a tooltip reachable by keyboard', async () => {
    const { container } = render(<Fact icon="smartphone" text="App" label="Canal" iconOnly />)
    // The accessible text is there (visually hidden); the bubble is visual only.
    expect(screen.getByText('Canal: App')).toHaveClass('sr-only')
    const bubble = container.querySelector('[aria-hidden="true"].group-hover\\/tooltip\\:block')
    expect(bubble).toHaveTextContent('App')
    const trigger = screen.getByText('Canal: App').parentElement!
    expect(trigger).toHaveAttribute('tabindex', '0')
    expect(bubble).toHaveClass('group-focus-visible/tooltip:block')
  })

  it('is not focusable inside a control, and adds a context tooltip to a visible fact', () => {
    render(
      <button type="button">
        <Fact icon="flag" text="Prioridad alta" iconOnly focusable={false} />
        <Fact icon="clock" text="hace 2 min" tooltip="Última actividad" focusable={false} />
      </button>,
    )
    const button = screen.getByRole('button')
    expect(button).toHaveAccessibleName(/Prioridad alta/)
    expect(button.querySelector('[tabindex]')).toBeNull()
    expect(button).toHaveTextContent('Última actividad')
  })

  it('draws language marks after the text, in place of the icon, or before a language name', () => {
    const { container } = render(
      <FactList
        items={[
          { key: 'a', icon: 'languages', text: 'Hablas', languages: ['pt'], tag: 'Regla 3' },
          { key: 'b', icon: 'languages', text: '', label: 'Idiomas', languages: ['es', 'pt'] },
          { key: 'c', icon: 'languages', text: 'Português', label: 'Idioma', language: 'pt' },
        ]}
      />,
    )
    const named = screen.getAllByRole('listitem')[2]!
    // A language as the value: icon, its mark, then its own name.
    expect(named).toHaveTextContent(/^Idioma: PTPortuguês$/)
    expect(within(named).getByText('Português')).toHaveAttribute('lang', 'pt')
    const [spoken, marks] = screen.getAllByRole('listitem')
    // Text, the marks' name (screen readers), the code, the tooltip bubble, the tag.
    expect(spoken).toHaveTextContent('HablasPortuguêsPTPortuguêsRegla 3')
    expect(spoken!.querySelectorAll('svg')).toHaveLength(2) // the icon and the flag
    expect(marks).toHaveTextContent('Idiomas: Español y PortuguêsESPTEspañol y Português')
    expect(marks!.querySelectorAll('svg')).toHaveLength(2) // two flags, no icon
    expect(container.querySelectorAll('svg[data-language]')).toHaveLength(4)
  })

  it('says a fact as a control names it', () => {
    expect(spokenFact({ label: 'Canal', text: 'App' })).toBe('Canal: App')
    expect(spokenFact({ label: 'Por idioma', text: '', languages: ['pt'] })).toBe(
      'Por idioma: Português',
    )
    expect(spokenFact({ text: 'Hablas', languages: ['es', 'pt'] })).toBe(
      'Hablas Español y Português',
    )
  })

  it('lists facts as list items and renders nothing for none', () => {
    const { container, rerender } = render(
      <FactList
        aria-label="Datos"
        items={[
          { key: 'a', icon: 'smartphone', text: 'App' },
          { key: 'b', icon: 'clock', text: 'hace 2 min', tone: 'muted' },
        ]}
      />,
    )
    expect(screen.getByRole('list', { name: 'Datos' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'App',
      'hace 2 min',
    ])
    rerender(<FactList items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
