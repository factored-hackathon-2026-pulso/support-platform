import { describe, expect, it } from 'vitest'
import { makeStages, makeTypeStage } from '@/test/stage-fixtures'
import {
  agentDisplayName,
  agentIdFor,
  agentName,
  draftBreakdown,
  lastChangeLine,
  maturitySteps,
  moveBackOptions,
  moveBackResult,
  panoramaTypes,
  readyTypes,
  ruleLines,
  signalLine,
  stageLegend,
  stageView,
  typeCategory,
  typeStage,
} from './model'

const RULE = makeStages().rule

function withSignals(
  entry: ReturnType<typeof makeTypeStage>,
  signals: Partial<ReturnType<typeof makeTypeStage>['signals']>,
) {
  return { ...entry, signals: { ...entry.signals, ...signals } }
}

describe('the panorama', () => {
  it('lists the types closest to an agent first', () => {
    expect(panoramaTypes(makeStages()).map((t) => t.caseType)).toEqual([
      'undue_charge',
      'unrecognized_charge',
      'app_issue',
      'branch_service',
      'service_quality',
      'virtual_card',
    ])
    expect(panoramaTypes({ ...makeStages(), available: false })).toEqual([])
    expect(panoramaTypes(undefined)).toEqual([])
  })

  it('reads the type the URL names, only among the stages', () => {
    expect(typeStage(makeStages(), 'app_issue')?.stage).toBe(2)
    expect(typeStage(makeStages(), 'none')).toBeNull()
    expect(typeStage(makeStages(), null)).toBeNull()
  })

  it('says each stage with its bars, the agent with all of them', () => {
    expect(stageView(makeTypeStage('app_issue', 2))).toEqual({
      label: 'Etapa 2',
      tip: 'El copiloto propone herramientas',
      bars: [true, true, false],
      agent: false,
      ready: false,
    })
    expect(stageView(makeTypeStage('unrecognized_charge', 3, 'active'))).toMatchObject({
      label: 'Con agente',
      tip: 'Lo atiende un agente',
      bars: [true, true, true],
      agent: true,
    })
    expect(stageView(makeTypeStage('undue_charge', 3, 'ready')).ready).toBe(true)
    expect(stageLegend().map((item) => item.label)).toEqual([
      '0 solo personas',
      '1 responde',
      '2 propone herramientas',
      '3 propone respuestas',
      'Con agente',
    ])
  })

  it('names the dataset category, the team-generated type as such', () => {
    expect(typeCategory('undue_charge')).toBe('Comisiones')
    expect(typeCategory('virtual_card')).toBe('Producto nuevo (ejemplo)')
  })

  it('measures each stage by its own signal', () => {
    expect(
      signalLine(withSignals(makeTypeStage('virtual_card', 0), { resolvedCases: 2 }), RULE),
    ).toBe('2 de 10 casos resueltos por el equipo')
    expect(
      signalLine(
        withSignals(makeTypeStage('service_quality', 1), { askedCases: 7, closedCases: 10 }),
        RULE,
      ),
    ).toBe('Preguntas al copiloto en 7 de 10 casos')
    expect(signalLine(makeTypeStage('branch_service', 1), RULE)).toBe(
      'Todavía no hay casos cerrados en esta etapa',
    )
    expect(
      signalLine(
        withSignals(makeTypeStage('app_issue', 2), { toolCases: 10, toolUsedCases: 6 }),
        RULE,
      ),
    ).toBe('Herramientas usadas en 6 de 10 casos con propuestas')
    expect(
      signalLine(
        withSignals(makeTypeStage('undue_charge', 3, 'ready'), { drafts: 100, draftsAsIs: 84 }),
        RULE,
      ),
    ).toBe('84 de los últimos 100 borradores, tal cual o con cambios menores')
    expect(signalLine(makeTypeStage('unrecognized_charge', 3, 'active'), RULE)).toBe(
      'Lo atiende el agente Disputas',
    )
  })

  it('finds the types waiting for an agent', () => {
    expect(readyTypes(makeStages()).map((t) => t.caseType)).toEqual(['undue_charge'])
  })
})

describe('one type', () => {
  const ready = {
    ...makeTypeStage('undue_charge', 3, 'ready'),
    reached: [
      { stage: 1, since: '2026-08-04T15:00:00Z' },
      { stage: 2, since: '2026-09-02T15:00:00Z' },
      { stage: 3, since: '2026-09-15T15:00:00Z' },
    ],
    agentSince: '2026-10-04T15:00:00Z',
    signals: {
      ...makeTypeStage('undue_charge', 3).signals,
      drafts: 100,
      draftsAsIs: 84,
      draftsEdited: 9,
      draftsDiscarded: 7,
    },
  }

  it('tells how it matured and since when', () => {
    expect(maturitySteps(ready).map((s) => [s.title, s.when, s.state])).toEqual([
      ['El copiloto responde', 'Desde el 4 ago 2026', 'done'],
      ['El copiloto propone herramientas', 'Desde el 2 sep 2026', 'done'],
      ['El copiloto propone respuestas', 'Desde el 15 sep 2026', 'done'],
      ['Agente', 'Propuesto el 4 oct 2026', 'done'],
    ])
    expect(maturitySteps(makeTypeStage('app_issue', 2)).map((s) => s.state)).toEqual([
      'done',
      'done',
      'later',
      'later',
    ])
  })

  it('states the team rule against today, only the current step with its value', () => {
    const app = withSignals(makeTypeStage('app_issue', 2), { toolCases: 10, toolUsedCases: 6 })
    expect(ruleLines(app, RULE).map((line) => [line.step, line.now, line.state])).toEqual([
      ['Etapa 0 a 1', 'Cumplida', 'met'],
      ['Etapa 1 a 2', 'Cumplida', 'met'],
      ['Etapa 2 a 3', 'Hoy: 6 de 10 casos', 'current'],
      ['Etapa 3 a agente', 'Todavía no', 'later'],
    ])
    expect(ruleLines(app, RULE)[2]?.rule).toBe(
      'Las herramientas propuestas se usan en 70 % de los casos, con al menos 10',
    )
    expect(ruleLines(ready, RULE).every((line) => line.state === 'met')).toBe(true)
  })

  it('breaks the drafts down from stage 3 only', () => {
    expect(draftBreakdown(ready)).toEqual({ total: 100, asIs: 84, edited: 9, discarded: 7 })
    expect(draftBreakdown(makeTypeStage('app_issue', 2))).toBeNull()
  })

  it('offers the earlier stages, withdrawing a proposal, never with an agent serving it', () => {
    expect(moveBackOptions(ready).map((o) => [o.value, o.label])).toEqual([
      [3, 'Etapa 3: retirar la propuesta de agente'],
      [2, 'Etapa 2: el copiloto propone herramientas'],
      [1, 'Etapa 1: el copiloto responde'],
      [0, 'Etapa 0: solo personas'],
    ])
    expect(moveBackOptions(makeTypeStage('virtual_card', 0))).toEqual([])
    expect(moveBackOptions(makeTypeStage('unrecognized_charge', 3, 'active'))).toEqual([])
    expect(moveBackResult('app_issue', 1, true, false)).toBe('Problema con app volvió a la etapa 1')
    expect(moveBackResult('undue_charge', 3, true, true)).toBe(
      'Se retiró la propuesta de agente de Cobro indebido',
    )
    expect(moveBackResult('app_issue', 1, false, false)).toBe(
      'Problema con app ya estaba en esa etapa',
    )
  })

  it('says the last change and who made it', () => {
    const moved = {
      ...makeTypeStage('app_issue', 1),
      lastChange: {
        kind: 'moved_back' as const,
        at: '2026-10-04T15:00:00Z',
        byName: 'Lucía Herrera',
      },
    }
    expect(lastChangeLine(moved)).toBe('Lo devolvió Lucía Herrera')
    expect(lastChangeLine(makeTypeStage('app_issue', 1))).toBeNull()
  })

  it('names the agent of a type: its own, else a suggested id', () => {
    expect(agentIdFor(makeTypeStage('unrecognized_charge', 3, 'active'))).toBe('disputas')
    expect(agentIdFor(ready)).toBe('cobros')
    expect(agentName('calidad-servicio')).toBe('Calidad servicio')
    expect(agentName('disputas')).toBe('Disputas')
  })
})

describe('agentDisplayName', () => {
  it("uses Supervisión's name for the agent serving a type, else the id in words", () => {
    const named = {
      ...makeTypeStage('unrecognized_charge', 3, 'active'),
      agentName: 'Dani Disputas',
    }
    const stages = makeStages({ types: [named] })
    expect(agentDisplayName(stages, 'disputas')).toBe('Dani Disputas')
    expect(agentDisplayName(stages, 'calidad-servicio')).toBe('Calidad servicio')
    expect(agentDisplayName(undefined, 'disputas')).toBe('Disputas')
  })
})
