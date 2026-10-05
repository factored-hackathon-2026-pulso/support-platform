import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('keeps a short subtitle on one line', () => {
    render(<PageHeader title="Colas" subtitle="Casos sin asignar" />)
    expect(screen.getByText('Casos sin asignar')).toHaveClass('truncate')
  })

  it('lets an explanatory subtitle wrap instead of cutting it', () => {
    const intro =
      'Cada tipo de caso madura con lo que hace el equipo. Cuando un tipo completa las tres etapas, el sistema propone un agente.'
    render(<PageHeader title="Automatización" subtitle={intro} wrapSubtitle />)
    const subtitle = screen.getByText(intro)
    expect(subtitle).not.toHaveClass('truncate')
    expect(subtitle).toHaveClass('text-pretty')
  })
})
