import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Fact, FactList } from './Fact'

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
