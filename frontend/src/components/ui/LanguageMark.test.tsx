import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { languagesName, sortLanguages } from './language'
import {
  LanguageFlag,
  LanguageMark,
  LanguageMarks,
  LanguageName,
  LanguageOptionLabel,
} from './LanguageMark'

describe('language names', () => {
  it('keeps the known languages once, in canonical order', () => {
    expect(sortLanguages(['pt', 'xx', 'es', 'pt'])).toEqual(['es', 'pt'])
    expect(sortLanguages([])).toEqual([])
  })

  it('names a group with each language in its own name', () => {
    expect(languagesName(['es'])).toBe('Español')
    expect(languagesName(['pt'])).toBe('Português')
    expect(languagesName(['pt', 'es'])).toBe('Español y Português')
    expect(languagesName([])).toBe('')
  })
})

describe('LanguageFlag / LanguageMark', () => {
  it('draws a decorative 21:15 flag sized by its width, with no ids', () => {
    const { container } = render(
      <>
        <LanguageFlag language="es" />
        <LanguageFlag language="pt" width={21} />
      </>,
    )
    const [es, pt] = Array.from(container.querySelectorAll('svg'))
    expect(es).toHaveAttribute('aria-hidden', 'true')
    expect(es).toHaveAttribute('width', '18')
    expect(es).toHaveAttribute('height', '13')
    expect(es).toHaveAttribute('data-language', 'es')
    expect(pt).toHaveAttribute('width', '21')
    expect(pt).toHaveAttribute('height', '15')
    expect(pt).toHaveAttribute('data-language', 'pt')
    expect(container.querySelector('[id]')).toBeNull()
  })

  it('shows the flag with the code, never the flag alone', () => {
    const { container } = render(<LanguageMark language="pt" />)
    const mark = container.firstElementChild!
    expect(mark).toHaveTextContent('PT')
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark.querySelector('svg[data-language="pt"]')).not.toBeNull()
  })
})

describe('LanguageMarks', () => {
  it('names the group for screen readers and in a focusable tooltip', () => {
    const { container } = render(<LanguageMarks languages={['pt', 'es']} />)
    const name = screen.getByText('Español y Português', { selector: '.sr-only' })
    const trigger = name.parentElement!
    expect(trigger).toHaveAttribute('tabindex', '0')
    expect(trigger).toHaveTextContent('ESPT')
    const codes = Array.from(container.querySelectorAll('svg')).map((svg) =>
      svg.getAttribute('data-language'),
    )
    expect(codes).toEqual(['es', 'pt'])
    const bubble = container.querySelector('[aria-hidden="true"].group-hover\\/tooltip\\:block')
    expect(bubble).toHaveTextContent('Español y Português')
  })

  it('marks the name with its language when there is one, and is not focusable in a control', () => {
    render(
      <button type="button">
        <LanguageMarks languages={['pt']} focusable={false} />
      </button>,
    )
    const button = screen.getByRole('button')
    expect(button).toHaveAccessibleName(/^Português/)
    expect(button.querySelector('[tabindex]')).toBeNull()
    expect(screen.getByText('Português', { selector: '.sr-only' })).toHaveAttribute('lang', 'pt')
  })

  it('renders nothing for no known language', () => {
    const { container } = render(<LanguageMarks languages={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('LanguageName / LanguageOptionLabel', () => {
  it('shows the mark and only the native name', () => {
    const { container } = render(<LanguageName language="pt" />)
    expect(container).toHaveTextContent(/^PTPortuguês$/)
    expect(screen.getByText('Português')).toHaveAttribute('lang', 'pt')
  })

  it('labels an option with the flag and the native name', () => {
    render(
      <label>
        <input type="checkbox" />
        <LanguageOptionLabel language="es" />
      </label>,
    )
    const option = screen.getByRole('checkbox', { name: 'Español' })
    const flag = option.parentElement!.querySelector('svg')
    expect(flag).toHaveAttribute('width', '21')
    expect(flag).toHaveAttribute('aria-hidden', 'true')
  })
})
