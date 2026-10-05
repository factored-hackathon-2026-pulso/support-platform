import { describe, expect, it } from 'vitest'
import { makeStages, makeTypeStage } from '@/test/stage-fixtures'
import { copilotModeOf, stageOfType, stageStrip } from './stages'

describe('copilotModeOf (a case gets its type stage)', () => {
  const stages = makeStages()

  it('follows the stage of the case type', () => {
    expect(copilotModeOf(stages, 'virtual_card')).toBeNull()
    expect(copilotModeOf(stages, 'service_quality')).toBe('answer')
    expect(copilotModeOf(stages, 'app_issue')).toBe('tools')
    expect(copilotModeOf(stages, 'undue_charge')).toBe('drafts')
    expect(copilotModeOf(stages, 'unrecognized_charge')).toBe('drafts')
  })

  it('gives no copilot to "Sin tipo", unknown stages or AI off', () => {
    expect(copilotModeOf(stages, 'none')).toBeNull()
    expect(copilotModeOf(stages, undefined)).toBeNull()
    expect(copilotModeOf(undefined, 'undue_charge')).toBeNull()
    expect(copilotModeOf(makeStages({ available: false, types: [] }), 'undue_charge')).toBeNull()
    expect(stageOfType(makeStages({ types: [] }), 'undue_charge')).toBeNull()
  })
})

describe('stageStrip (IaWorkspace)', () => {
  it('fills the bars up to the stage and says what the copilot does', () => {
    expect(stageStrip(makeTypeStage('virtual_card', 0))).toEqual({
      bars: [false, false, false],
      agent: false,
      line: 'Etapa 0 de 3: lo resuelve el equipo; el copiloto todavía no aprende de este tipo',
    })
    expect(stageStrip(makeTypeStage('app_issue', 2))).toEqual({
      bars: [true, true, false],
      agent: false,
      line: 'Etapa 2 de 3: el copiloto propone herramientas',
    })
    expect(stageStrip(makeTypeStage('undue_charge', 3, 'ready')).line).toBe(
      'Etapa 3 de 3: el copiloto propone respuestas y deja herramientas listas',
    )
  })

  it('a type an agent serves fills every bar and shows the agent', () => {
    expect(stageStrip(makeTypeStage('unrecognized_charge', 3, 'active'))).toEqual({
      bars: [true, true, true],
      agent: true,
      line: 'Con agente: el asistente virtual atiende este tipo y te pasa lo que no resuelve',
    })
  })
})
