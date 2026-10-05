import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { builderMessage } from '@/test/automation-fixtures'
import { makeTypeStage } from '@/test/stage-fixtures'
import { chatEntries, describeChatFailure, newAgentRequest } from './builder-chat'

describe('the builder chat', () => {
  it('shows the thread, then the message in flight', () => {
    const thread = { available: true, messages: [builderMessage('m1', 'person', 'Hola')] }
    const entries = chatEntries(thread, { clientMessageId: 'c2', text: 'Otro', status: 'sending' })
    expect(entries.map((e) => e.key)).toEqual(['m1', 'c2'])
    expect(chatEntries(thread, null)).toHaveLength(1)
    expect(chatEntries(undefined, null)).toEqual([])
  })

  it('words why a message got no answer', () => {
    expect(
      describeChatFailure(new ApiProblem({ status: 409, code: 'builder_busy', title: 'x' })),
    ).toBe('El constructor todavía responde el mensaje anterior.')
    expect(describeChatFailure(ApiProblem.network())).toBe(
      'El constructor no respondió. Tu mensaje quedó guardado: reintenta en un momento.',
    )
  })

  it('asks the builder for the agent of a type, in Spanish, with the evidence', () => {
    const ready = {
      ...makeTypeStage('undue_charge', 3, 'ready'),
      signals: { ...makeTypeStage('undue_charge', 3).signals, drafts: 100, draftsAsIs: 84 },
    }
    expect(newAgentRequest('undue_charge', 'cobros', ready)).toBe(
      'Agente: cobros. Objetivo: un agente nuevo que atienda los chats de los casos de tipo ' +
        '"Cobro indebido" como lo hace el equipo y pase a una persona lo que no pueda resolver. ' +
        'El equipo envía 84 de los últimos 100 borradores del copiloto tal cual o con cambios menores.',
    )
    expect(
      newAgentRequest('app_issue', 'soporte-app', makeTypeStage('app_issue', 2)),
    ).not.toContain('borradores')
  })
})
