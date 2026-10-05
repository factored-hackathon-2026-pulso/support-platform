import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import {
  composerTextWithDraft,
  copilotNotice,
  copilotSurfaces,
  copilotTurns,
  describeAskFailure,
  describeSuggestFailure,
  emptyThreadTitle,
  escalationReason,
  firstName,
  isAsking,
  mergeExchange,
  normalizeQuestion,
  questionCounter,
  removeAsk,
  starterQuestions,
  suggestionView,
  toolQuestion,
  toolResult,
  upsertAsk,
} from './model'
import type { CopilotAsk, CopilotMessage, CopilotSuggestion } from './types'

const AT = '2026-10-04T19:30:00Z'

function question(id: string, text: string): CopilotMessage {
  return { id, role: 'analyst', text, createdAt: AT, answers: null }
}

function answer(id: string, to: string, text: string): CopilotMessage {
  return { id, role: 'copilot', text, createdAt: AT, answers: to }
}

function ask(overrides: Partial<CopilotAsk> = {}): CopilotAsk {
  return {
    clientMessageId: 'cm-1',
    text: '¿Qué productos tiene?',
    createdAt: AT,
    status: 'asking',
    error: null,
    retryable: true,
    ...overrides,
  }
}

function suggestion(overrides: Partial<CopilotSuggestion> = {}): CopilotSuggestion {
  return {
    id: 'CPS-1',
    caseId: 'CASE-1',
    trigger: 'customer_message',
    status: 'ready',
    stale: false,
    createdAt: AT,
    replyDecision: null,
    escalationAccepted: false,
    failureCode: null,
    suggestions: [
      { type: 'reply', text: 'Hola Natalia, ya reviso.', citations: [], language: 'es' },
      { type: 'tool', tool: 'leer_movimientos@1', label: 'Movimientos', why: 'Ver el cargo' },
      {
        type: 'action',
        tool: 'radicar_pqr@1',
        summary: 'Radicar una disputa por 120 USD',
        executable: false,
      },
      {
        type: 'escalate',
        reasonCode: 'policy:pide_supervisor',
        evidence: ['Pidió hablar con un supervisor'],
        motiveDraft: 'La clienta pide supervisión.',
      },
    ],
    ...overrides,
  }
}

describe('copilotSurfaces (the stage as one switch)', () => {
  it('shows more as the mode grows, and nothing without a mode', () => {
    expect(copilotSurfaces('answer')).toEqual({ copilot: true, tools: false, draft: false })
    expect(copilotSurfaces('tools')).toEqual({ copilot: true, tools: true, draft: false })
    expect(copilotSurfaces('drafts')).toEqual({ copilot: true, tools: true, draft: true })
    expect(copilotSurfaces(null)).toEqual({ copilot: false, tools: false, draft: false })
  })
})

describe('the question box', () => {
  it('trims, refuses empty and longer than 2000, and counts', () => {
    expect(normalizeQuestion('  ¿Cuánto debe?  ')).toBe('¿Cuánto debe?')
    expect(normalizeQuestion('   ')).toBeNull()
    expect(normalizeQuestion('a'.repeat(2001))).toBeNull()
    expect(questionCounter(' hola ')).toBe('4/2000')
  })

  it('says what the copilot does with her first name', () => {
    expect(firstName('Natalia Guzmán Rincón')).toBe('Natalia')
    expect(copilotNotice('Natalia Guzmán Rincón')).toBe(
      'Consulta y calcula con los datos de Natalia. No hace cambios ni le escribe al cliente.',
    )
    expect(emptyThreadTitle('Natalia Guzmán Rincón')).toBe('Pregúntale sobre Natalia')
    expect(starterQuestions()).toHaveLength(3)
  })
})

describe('copilotTurns', () => {
  it('groups several answers under their question', () => {
    const turns = copilotTurns(
      [
        question('CPM-1', '¿Cuánto debe?'),
        answer('CPM-2', 'CPM-1', 'Debe 1.342,80 USD.'),
        answer('CPM-3', 'CPM-1', '¿Qué más necesitas?'),
      ],
      [],
    )
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ key: 'CPM-1', state: 'answered', clientMessageId: null })
    expect(turns[0]?.answers.map((a) => a.text)).toEqual([
      'Debe 1.342,80 USD.',
      '¿Qué más necesitas?',
    ])
  })

  it('appends the questions in flight or failed, standing for the stored unanswered one', () => {
    const failed = ask({ status: 'failed', error: 'No hay conexión.', text: '¿Tiene reclamos?' })
    const turns = copilotTurns([question('CPM-9', '¿Tiene reclamos?')], [failed])
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      key: 'cm-1',
      state: 'failed',
      error: 'No hay conexión.',
      clientMessageId: 'cm-1',
    })
  })

  it('marks a stored question without an answer as unanswered', () => {
    expect(copilotTurns([question('CPM-1', '¿Hola?')], [])[0]?.state).toBe('unanswered')
  })

  it('knows when a question is on its way', () => {
    expect(isAsking([ask()])).toBe(true)
    expect(isAsking([ask({ status: 'failed' })])).toBe(false)
  })

  it('keeps a retried question in its place and removes an answered one', () => {
    const first = ask({ clientMessageId: 'a', status: 'failed' })
    const second = ask({ clientMessageId: 'b' })
    const retried = upsertAsk([first, second], { ...first, status: 'asking' })
    expect(retried.map((item) => [item.clientMessageId, item.status])).toEqual([
      ['a', 'asking'],
      ['b', 'asking'],
    ])
    expect(removeAsk(retried, 'a').map((item) => item.clientMessageId)).toEqual(['b'])
  })

  it('merges an exchange once (a replay adds nothing)', () => {
    const thread = { caseId: 'CASE-1', available: true, messages: [] }
    const exchange = {
      question: question('CPM-1', '¿Cuánto debe?'),
      answers: [answer('CPM-2', 'CPM-1', 'Debe 10 USD.')],
      replayed: false,
    }
    const merged = mergeExchange(thread, exchange)
    expect(merged.messages.map((m) => m.id)).toEqual(['CPM-1', 'CPM-2'])
    expect(mergeExchange(merged, { ...exchange, replayed: true })).toBe(merged)
  })
})

describe('describeAskFailure', () => {
  it('lets an outage or a busy copilot be retried, not a closed case', () => {
    expect(
      describeAskFailure(new ApiProblem({ status: 503, code: 'agent_core_unavailable' })),
    ).toEqual({ message: 'No se pudo responder. Inténtalo de nuevo.', retryable: true })
    expect(
      describeAskFailure(new ApiProblem({ status: 409, code: 'copilot_busy' })).retryable,
    ).toBe(true)
    expect(describeAskFailure(new ApiProblem({ status: 409, code: 'case_closed' }))).toEqual({
      message: 'El caso se cerró: el copiloto ya no responde.',
      retryable: false,
    })
    expect(describeAskFailure(new ApiProblem({ status: 0, code: 'network_error' })).retryable).toBe(
      true,
    )
  })
})

describe('suggestionView', () => {
  it('reads the newest suggestion by kind', () => {
    const view = suggestionView({ available: true, suggestion: suggestion() })
    expect(view?.reply?.text).toBe('Hola Natalia, ya reviso.')
    expect(view?.tools.map((tool) => tool.label)).toEqual(['Movimientos'])
    expect(view?.actions.map((action) => action.summary)).toEqual([
      'Radicar una disputa por 120 USD',
    ])
    expect(view?.escalation?.motiveDraft).toBe('La clienta pide supervisión.')
  })

  it('drops a decided draft and an accepted escalation', () => {
    const view = suggestionView({
      available: true,
      suggestion: suggestion({ replyDecision: 'discarded', escalationAccepted: true }),
    })
    expect(view?.reply).toBeNull()
    expect(view?.escalation).toBeNull()
    expect(view?.tools).toHaveLength(1)
  })

  it('is null when unavailable or there is none', () => {
    expect(suggestionView(undefined)).toBeNull()
    expect(suggestionView({ available: false, suggestion: null })).toBeNull()
    expect(suggestionView({ available: true, suggestion: null })).toBeNull()
  })
})

describe('tools', () => {
  const tool = { tool: 'leer_movimientos@1', label: 'Movimientos' }

  it('asks a predefined question and finds its newest answer', () => {
    expect(toolQuestion(tool)).toBe(
      'Consulta Movimientos (leer_movimientos@1) para este cliente y dime qué encontraste.',
    )
    const turns = copilotTurns(
      [
        question('CPM-1', toolQuestion(tool)),
        answer('CPM-2', 'CPM-1', 'Tres cargos.'),
        question('CPM-3', 'Otra cosa'),
      ],
      [],
    )
    expect(toolResult(turns, tool)?.answers[0]?.text).toBe('Tres cargos.')
    expect(toolResult(turns, { tool: 'x@1', label: 'X' })).toBeNull()
  })
})

describe('escalationReason', () => {
  it('words policy and rule codes', () => {
    expect(escalationReason('policy:pide_supervisor')).toBe('Una política lo pide: Pide supervisor')
    expect(escalationReason('rule:tercer_contacto_7d')).toBe(
      'Una regla del copiloto lo pide: Tercer contacto 7d',
    )
    expect(escalationReason('sla_vencido')).toBe('Sla vencido')
    expect(escalationReason('')).toBe('El copiloto recomienda escalarlo')
  })
})

describe('describeSuggestFailure', () => {
  it('retries an outage with the same key, never a busy copilot', () => {
    expect(
      describeSuggestFailure(new ApiProblem({ status: 502, code: 'agent_core_rejected' })),
    ).toEqual({ message: 'No se pudo preparar la sugerencia. Inténtalo de nuevo.', retry: true })
    expect(
      describeSuggestFailure(new ApiProblem({ status: 409, code: 'copilot_busy' })).retry,
    ).toBe(false)
  })
})

describe('composerTextWithDraft', () => {
  it('keeps what she wrote and adds the draft after it', () => {
    expect(composerTextWithDraft('', 'Hola')).toBe('Hola')
    expect(composerTextWithDraft('  Buenas ', 'Hola')).toBe('Buenas\n\nHola')
  })
})
