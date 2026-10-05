import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
})
