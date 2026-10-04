import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FACT_ICONS } from './fact-icons'
import { PriorityIcon } from './PriorityIcon'
import { PRIORITY_LEVELS } from './priority-levels'

describe('PriorityIcon', () => {
  it.each(PRIORITY_LEVELS)('draws %s as a decorative glyph', (level) => {
    const { container } = render(<PriorityIcon level={level} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('data-priority', level)
    expect(svg).toHaveAttribute('width', '14')
  })

  it('fills one, two or three of three bars; none is three dotted bars', () => {
    const bars = (level: 'none' | 'low' | 'medium' | 'high') => {
      const { container } = render(<PriorityIcon level={level} />)
      return [...container.querySelectorAll('[data-bar]')].map((bar) =>
        bar.getAttribute('data-bar'),
      )
    }
    expect(bars('none')).toEqual(['dotted', 'dotted', 'dotted'])
    expect(bars('low')).toEqual(['on', 'off', 'off'])
    expect(bars('medium')).toEqual(['on', 'on', 'off'])
    expect(bars('high')).toEqual(['on', 'on', 'on'])
  })

  it('draws critical as an exclamation in a filled square, in the danger tone', () => {
    const { container } = render(<PriorityIcon level="critical" size={16} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveClass('text-danger')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg.querySelector('rect')).toHaveAttribute('fill', 'currentColor')
    expect(svg.querySelector('[data-bar]')).toBeNull()
  })

  it('is a fact icon too (cards and supervision rows name it from the model)', () => {
    const Glyph = FACT_ICONS['priority-high']
    const { container } = render(<Glyph size={13} className="x" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('data-priority', 'high')
    expect(svg).toHaveAttribute('width', '13')
    expect(svg).toHaveClass('x')
  })
})
