import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setTestLocale } from '@/test/render'
import { makeTypeStage } from '@/test/stage-fixtures'
import { StageStrip } from './StageStrip'

describe('StageStrip (slice 21)', () => {
  it('names the type, fills the bars and says the stage in one line', () => {
    render(<StageStrip typeLabel="Problema con app" stage={makeTypeStage('app_issue', 2)} />)
    const strip = screen.getByTestId('stage-strip')
    expect(strip).toHaveTextContent(
      'Tipo de caso: Problema con appEtapa 2 de 3: el copiloto propone herramientas',
    )
    expect(strip.querySelectorAll('[data-filled]')).toHaveLength(2)
  })

  it('shows the agent for a type an agent serves', () => {
    render(
      <StageStrip
        typeLabel="Cargo no reconocido"
        stage={makeTypeStage('unrecognized_charge', 3, 'active')}
      />,
    )
    const strip = screen.getByTestId('stage-strip')
    expect(strip.querySelectorAll('[data-filled]')).toHaveLength(3)
    expect(strip.querySelector('svg.lucide-bot')).not.toBeNull()
    expect(strip).toHaveTextContent('Con agente')
  })

  it('keeps the type on one line and lets the stage line wrap instead of cutting it', () => {
    // A narrow conversation (support panel open at 1440 px) cut the line with "…" and broke
    // "Cargo no reconocido" over two lines; the browser check is in e2e/ai.spec.ts.
    render(
      <StageStrip
        typeLabel="Cargo no reconocido"
        stage={makeTypeStage('unrecognized_charge', 3, 'active')}
      />,
    )
    expect(screen.getByTestId('stage-strip-type')).toHaveClass('whitespace-nowrap', 'shrink-0')
    const line = screen.getByTestId('stage-strip-line')
    expect(line).not.toHaveClass('truncate')
    expect(line).toHaveClass('min-w-0', 'flex-1')
  })

  it('says the stage in Portuguese', () => {
    setTestLocale('pt-BR')
    const { rerender } = render(
      <StageStrip typeLabel="Problema no app" stage={makeTypeStage('app_issue', 2)} />,
    )
    expect(screen.getByTestId('stage-strip')).toHaveTextContent(
      'Tipo de caso: Problema no appEtapa 2 de 3: o copiloto sugere ferramentas',
    )
    rerender(<StageStrip typeLabel="Problema no app" stage={makeTypeStage('app_issue', 0)} />)
    expect(screen.getByTestId('stage-strip')).toHaveTextContent(
      'Etapa 0 de 3: a equipe resolve; o copiloto ainda não aprende com este tipo',
    )
    rerender(
      <StageStrip
        typeLabel="Cargo no reconocido"
        stage={makeTypeStage('unrecognized_charge', 3, 'active')}
      />,
    )
    expect(screen.getByTestId('stage-strip')).toHaveTextContent(
      'Com agente: o assistente virtual atende este tipo e passa para você o que não resolve',
    )
  })
})
