import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { makeChange, makeEvalReport, makeRelease } from '@/test/automation-fixtures'
import {
  agentVersionIn,
  changeView,
  describeBuilderFailure,
  draftLanguages,
  draftTools,
  isMissingSuite,
  proposalSource,
  proposalStatus,
  proposalSteps,
  reportView,
  suiteFor,
  toolName,
} from './proposals'

function problem(status: number, code: string, extensions: Record<string, unknown> = {}) {
  return new ApiProblem({ status, code, title: 'x', extensions })
}

describe('a proposal', () => {
  it('shows its state as a glyph and a word, an unknown one as such', () => {
    expect(proposalStatus('draft')).toEqual({ shape: 'dashed', tone: 'neutral', label: 'Borrador' })
    expect(proposalStatus('candidate').label).toBe('Lista para probar')
    expect(proposalStatus('published')).toMatchObject({ shape: 'check', label: 'Publicada' })
    expect(proposalStatus('rejected').label).toBe('Otro estado')
  })

  it('walks from draft to an active agent', () => {
    expect(proposalSteps('evaluated', false).map((s) => [s.label, s.state])).toEqual([
      ['Borrador', 'done'],
      ['Lista para probar', 'done'],
      ['Probada', 'current'],
      ['Aprobada', 'later'],
      ['Publicada', 'later'],
      ['Activa', 'later'],
    ])
    expect(proposalSteps('published', true).every((s) => s.state === 'done')).toBe(true)
  })

  it('says where it came from, the improvement engine included', () => {
    expect(proposalSource('chat')).toEqual({
      label: 'Del constructor',
      engine: false,
      registry: false,
    })
    expect(proposalSource('engine')).toEqual({
      label: 'Del motor de mejora',
      engine: true,
      registry: false,
    })
    expect(proposalSource('registry')).toEqual({
      label: 'Del registro',
      engine: false,
      registry: true,
    })
    expect(proposalSource('someday')).toEqual({
      label: 'Otro origen',
      engine: false,
      registry: false,
    })
  })

  it('reads each change of the draft without its raw content', () => {
    expect(changeView(makeChange(), 0)).toEqual({
      key: 'template:t/resumen:0',
      kind: 'Plantilla',
      id: 't/resumen',
      version: 'versión 1.1.0',
      description: 'Acorta el resumen',
      rationale: 'Se lee mejor',
      changelog: 'Máximo 3 líneas',
    })
    expect(changeView(makeChange({ kind: 'mystery' }), 2).kind).toBe('Otro elemento')
  })

  it('finds the tools and languages the agent of the draft has', () => {
    const agent = makeChange({
      kind: 'agent',
      content: {
        id: 'cobros',
        version: '1.0.0',
        tools_allowed: ['registry/leer_movimientos@1', 'leer_productos@1', 7],
        supported_locales: ['es', 'pt-BR'],
      },
    })
    expect(draftTools([agent], 'cobros')).toEqual([
      'registry/leer_movimientos@1',
      'leer_productos@1',
    ])
    expect(draftTools([agent], 'otro')).toEqual([])
    expect(toolName('registry/leer_movimientos@1')).toBe('Leer movimientos')
    expect(draftLanguages([agent], 'cobros')).toEqual(['es', 'pt'])
  })

  it('tests with the suite the draft brings, else the base release one, else none', () => {
    const suite = makeChange({
      kind: 'eval_suite',
      content: { id: 'suite-cobros', version: '1.0.0' },
    })
    expect(suiteFor([suite], null)).toEqual({ suiteId: 'suite-cobros', suiteVersion: '1.0.0' })
    const base = makeRelease({
      evalSuiteRefs: [{ kind: 'eval_suite', id: 'suite-disputas', version: '2.0.0' }],
    })
    expect(suiteFor([makeChange()], base)).toEqual({
      suiteId: 'suite-disputas',
      suiteVersion: '2.0.0',
    })
    expect(suiteFor([makeChange()], makeRelease())).toBeNull()
    expect(suiteFor([], undefined)).toBeNull()
  })

  it('shows the test report item by item', () => {
    const view = reportView(makeEvalReport({ verdict: 'fail' }))
    expect(view.passed).toBe(false)
    expect(view.summary).toBe('1 de 2 criterios')
    expect(view.items[0]).toMatchObject({
      metric: 'resuelve_sin_persona',
      verdict: 'Cumple',
      facts: ['Valor 0.92', 'Mínimo 0.85', 'Antes 0.90'],
    })
    expect(view.items[1]?.verdict).toBe('No cumple')
  })

  it('reads the agent version a release holds', () => {
    expect(agentVersionIn(makeRelease())).toBe('1.0.0')
    expect(agentVersionIn(undefined)).toBeNull()
  })
})

describe('builder failures', () => {
  it('words a wrong code with the attempts left, and the lock', () => {
    expect(
      describeBuilderFailure(problem(422, 'builder_step_up_invalid', { remainingAttempts: 3 })),
    ).toEqual({ kind: 'stepUp', message: 'El código no es correcto. Te quedan 3 intentos.' })
    expect(
      describeBuilderFailure(problem(422, 'builder_step_up_invalid', { remainingAttempts: 1 })),
    ).toEqual({ kind: 'stepUp', message: 'El código no es correcto. Te queda 1 intento.' })
    expect(describeBuilderFailure(problem(423, 'account_locked')).kind).toBe('locked')
  })

  it('keeps the structure of a failed gate, a loosened yardstick and violations', () => {
    const report = makeEvalReport({ verdict: 'fail' })
    expect(describeBuilderFailure(problem(409, 'registry_gate_failed', { report }))).toEqual({
      kind: 'gateFailed',
      report,
    })
    const loosened = [{ kind: 'floor_loosened', target: 'x', message: 'Baja el mínimo' }]
    expect(
      describeBuilderFailure(
        problem(409, 'registry_loosening_not_accepted', { yardstickLoosened: loosened }),
      ),
    ).toEqual({ kind: 'loosening', changes: loosened })
    expect(describeBuilderFailure(problem(422, 'registry_validation_failed')).kind).toBe(
      'violations',
    )
  })

  it('words the rest', () => {
    expect(describeBuilderFailure(problem(409, 'registry_conflict')).kind).toBe('conflict')
    expect(describeBuilderFailure(problem(409, 'invalid_transition'))).toEqual({
      kind: 'notReady',
      message: 'El tipo de caso ya no espera un agente. Revisa su etapa.',
    })
    expect(describeBuilderFailure(ApiProblem.network())).toEqual({
      kind: 'message',
      message: 'El motor de IA no respondió. Vuelve a intentarlo en un momento.',
    })
    expect(describeBuilderFailure(new Error('x'))).toEqual({
      kind: 'message',
      message: 'No pudimos completar la acción. Vuelve a intentarlo.',
    })
    expect(isMissingSuite(problem(404, 'registry_not_found'))).toBe(true)
    expect(isMissingSuite(problem(404, 'not_found'))).toBe(false)
  })
})
