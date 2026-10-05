import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { builderMessage } from '@/test/automation-fixtures'
import { makeTypeStage } from '@/test/stage-fixtures'
import { i18n } from '@/lib/i18n'
import { makeSummary } from '@/test/automation-fixtures'
import {
  MAX_GOAL,
  agentRequest,
  chatEntries,
  describeChatFailure,
  fitGoal,
  goalLength,
  isValidAgentId,
  newProposals,
} from './builder-chat'

describe('the builder chat', () => {
  it('shows the thread, then the message in flight', () => {
    const thread = {
      available: true,
      messages: [builderMessage('m1', 'person', 'Hola')],
      awaiting: null,
    }
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

  it("answers the builder's questions in its format: the id alone, a goal of 200 at most", () => {
    const ready = {
      ...makeTypeStage('undue_charge', 3, 'ready'),
      signals: { ...makeTypeStage('undue_charge', 3).signals, drafts: 100, draftsAsIs: 84 },
    }
    const request = agentRequest('undue_charge', 'cobros', ready)
    expect(request).toEqual({
      agentId: 'cobros',
      goal:
        'Atender los chats de "Cobro indebido" como lo hace el equipo y pasar a una persona lo que ' +
        'no pueda resolver. El equipo envía 84 de 100 borradores del copiloto sin cambios o con ' +
        'cambios menores.',
    })
    expect(goalLength(request.goal)).toBeLessThanOrEqual(MAX_GOAL)
    // without drafts there is no evidence to give
    expect(agentRequest('app_issue', 'soporte-app', makeTypeStage('app_issue', 2)).goal).toBe(
      'Atender los chats de "Problema con app" como lo hace el equipo y pasar a una persona lo ' +
        'que no pueda resolver.',
    )
  })

  it('drops the evidence when it would pass 200 characters', () => {
    const busy = {
      ...makeTypeStage('branch_service', 3, 'ready'),
      signals: {
        ...makeTypeStage('branch_service', 3).signals,
        drafts: 123_456_789,
        draftsAsIs: 123_456_789,
      },
    }
    const goal = agentRequest('branch_service', 'sucursales', busy).goal
    expect(goal).not.toContain('borradores')
    expect(goalLength(goal)).toBeLessThanOrEqual(MAX_GOAL)
  })

  it('writes the goal in the UI language', async () => {
    await i18n.changeLanguage('pt-BR')
    try {
      expect(agentRequest('undue_charge', 'cobros', makeTypeStage('undue_charge', 2)).goal).toBe(
        'Atender os chats de "Cobrança indevida" como a equipe faz e passar para uma pessoa o que ' +
          'não conseguir resolver.',
      )
    } finally {
      await i18n.changeLanguage('es')
    }
  })

  it("knows agent-core's rule for an agent id", () => {
    expect(['cobros', 'soporte-app', 't/saludo', 'a_1'].every(isValidAgentId)).toBe(true)
    expect(['Cobros', 'cobro indebido', '-cobros', '', 'cobrós'].some(isValidAgentId)).toBe(false)
  })

  it('cuts a goal at a word, counting characters as agent-core does', () => {
    const long = `${'palabra '.repeat(40)}fin`
    const cut = fitGoal(long)
    expect(goalLength(cut)).toBeLessThanOrEqual(MAX_GOAL)
    expect(cut.endsWith('palabra')).toBe(true)
    expect(goalLength('ação')).toBe(4)
    expect(fitGoal('  corto  ')).toBe('corto')
  })

  it('finds the proposals the builder made for her agent while she waited', () => {
    const before = new Set(['p-old'])
    const after = [
      makeSummary({ proposalId: 'p-new', agentId: 'cobros' }),
      makeSummary({ proposalId: 'p-other', agentId: 'disputas' }),
      makeSummary({ proposalId: 'p-old', agentId: 'cobros' }),
    ]
    expect(newProposals(before, after, 'cobros').map((p) => p.proposalId)).toEqual(['p-new'])
    expect(newProposals(null, after, 'cobros')).toEqual([])
  })
})
