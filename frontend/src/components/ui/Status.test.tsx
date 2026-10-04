import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Status } from './Status'
import { StatusIcon } from './StatusIcon'
import { STATUS_SHAPES } from './status-shapes'

describe('StatusIcon', () => {
  it.each(STATUS_SHAPES)('draws %s as a decorative 14px glyph in its tone', (shape) => {
    const { container } = render(<StatusIcon shape={shape} tone="warn" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('data-status-shape', shape)
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveClass('text-warn')
    expect(svg.childElementCount).toBeGreaterThan(0)
  })

  it('draws the dashed ring with dashes and the pies inside a ring', () => {
    const { container, rerender } = render(<StatusIcon shape="dashed" size={16} />)
    expect(container.querySelector('circle')).toHaveAttribute('stroke-dasharray')
    expect(container.querySelector('svg')).toHaveAttribute('width', '16')
    rerender(<StatusIcon shape="pie-75" />)
    expect(container.querySelector('circle')).toHaveAttribute('fill', 'none')
    expect(container.querySelector('path')).toHaveAttribute('fill', 'currentColor')
  })
})

describe('Status', () => {
  it('shows the glyph and the plain word, no pill', () => {
    render(<Status shape="pie-75" tone="warn" label="Por responder" />)
    const label = screen.getByText('Por responder')
    const status = label.parentElement!
    expect(status).toHaveClass('text-13', 'text-ink-2', 'gap-1.5')
    expect(status).not.toHaveClass('rounded-full')
    expect(status.querySelector('svg')).toHaveAttribute('data-status-shape', 'pie-75')
  })

  it('writes a strong state in the tone strong color, and an optional screen-reader label', () => {
    render(<Status shape="lock" tone="warn" label="Bloqueada" strong srLabel="Cuenta" title="x" />)
    const status = screen.getByText('Bloqueada').parentElement!
    expect(status).toHaveClass('text-warn-strong')
    expect(status).toHaveTextContent('Cuenta: Bloqueada')
    expect(status).toHaveAttribute('title', 'x')
  })

  it('icon only: the word is the tooltip and the accessible text', () => {
    const { container } = render(
      <Status shape="check" tone="closed" label="Cerrado" srLabel="Estado" iconOnly />,
    )
    expect(screen.getByText('Estado: Cerrado')).toHaveClass('sr-only')
    const trigger = screen.getByText('Estado: Cerrado').parentElement!
    expect(trigger).toHaveAttribute('tabindex', '0')
    const bubble = container.querySelector('[aria-hidden="true"].group-hover\\/tooltip\\:block')
    expect(bubble).toHaveTextContent('Cerrado')
  })

  it('icon only inside a control: not focusable, the word joins the control name', () => {
    render(
      <button type="button">
        Ana
        <Status shape="ring" tone="accent" label="Nuevo" iconOnly focusable={false} />
      </button>,
    )
    const button = screen.getByRole('button')
    expect(button).toHaveAccessibleName(/Nuevo/)
    expect(button.querySelector('[tabindex]')).toBeNull()
  })
})
