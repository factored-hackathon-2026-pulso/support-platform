import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { languagesName, sortLanguages } from './language'
import { LanguageMark, LanguageMarks, LanguageName } from './LanguageMark'

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

describe('LanguageMark', () => {
  it('shows one decorative globe, then the codes in canonical order', () => {
    const { container } = render(<LanguageMark languages={['pt', 'es']} />)
    const mark = container.firstElementChild!
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark).toHaveAttribute('data-languages', 'es pt')
    expect(mark).toHaveClass('text-12')
    expect(mark).toHaveTextContent(/^ESPT$/)
    const globes = mark.querySelectorAll('svg')
    expect(globes).toHaveLength(1)
    expect(globes[0]).toHaveClass('lucide-globe', 'text-muted')
    expect(globes[0]).toHaveAttribute('width', '14')
  })

  it('scales the globe with the codes, and renders nothing for no known language', () => {
    const { container } = render(<LanguageMark languages={['pt']} size="lg" />)
    expect(container.firstElementChild).toHaveClass('text-16')
    expect(container.querySelector('svg')).toHaveAttribute('width', '16')
    const { container: empty } = render(<LanguageMark languages={['xx']} />)
    expect(empty).toBeEmptyDOMElement()
  })
})

describe('LanguageMarks', () => {
  it('names the group for screen readers and in a focusable tooltip', () => {
    const { container } = render(<LanguageMarks languages={['pt', 'es']} />)
    const name = screen.getByText('Español y Português', { selector: '.sr-only' })
    const trigger = name.parentElement!
    expect(trigger).toHaveAttribute('tabindex', '0')
    expect(trigger).toHaveTextContent('ESPT')
    expect(trigger.querySelectorAll('svg')).toHaveLength(1)
    expect(container.querySelector('[data-languages="es pt"]')).not.toBeNull()
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

  it('takes a name of its own, and a size', () => {
    const { container } = render(
      <LanguageMarks languages={['es']} name="Cola en español" size="lg" />,
    )
    const name = screen.getByText('Cola en español', { selector: '.sr-only' })
    expect(name).not.toHaveAttribute('lang')
    expect(container.querySelector('[data-languages="es"].text-16')).toHaveTextContent('ES')
  })

  it('renders nothing for no known language', () => {
    const { container } = render(<LanguageMarks languages={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('LanguageName', () => {
  it('shows the globe and only the native name, no code', () => {
    const { container } = render(<LanguageName language="pt" />)
    expect(container).toHaveTextContent(/^Português$/)
    expect(screen.getByText('Português')).toHaveAttribute('lang', 'pt')
    const globe = container.querySelector('[data-language="pt"] svg')
    expect(globe).toHaveClass('lucide-globe')
    expect(globe).toHaveAttribute('aria-hidden', 'true')
  })
})
