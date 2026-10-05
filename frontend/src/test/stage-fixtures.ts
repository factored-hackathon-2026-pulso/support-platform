/**
 * The AI stages per case type (slice 21) as GET /ai/stages answers them, shaped like the seed:
 * Cargo no reconocido served by an agent, Cobro indebido at stage 3 and ready for an agent,
 * Problema con app at 2, Calidad de servicio and Atención en sucursal at 1, Tarjeta virtual at 0.
 */
import type { AiStages, CaseTypeStage } from '@/features/copilot'

const MODE = { 0: null, 1: 'answer', 2: 'tools', 3: 'drafts' } as const

export function makeTypeStage(
  caseType: CaseTypeStage['caseType'],
  stage: 0 | 1 | 2 | 3,
  agent: CaseTypeStage['agent'] = 'none',
): CaseTypeStage {
  return {
    caseType,
    stage,
    agent,
    copilotMode: MODE[stage],
    signals: {
      closedCases: 0,
      resolvedCases: 0,
      askedCases: 0,
      toolCases: 0,
      toolUsedCases: 0,
      drafts: 0,
      draftsAsIs: 0,
      draftsEdited: 0,
      draftsDiscarded: 0,
    },
    reached: [],
    agentSince: null,
    agentName: null,
    agentPaused: false,
    agentId: agent === 'active' ? 'disputas' : null,
    lastChange: null,
    version: 1,
  }
}

export function makeStages(overrides: Partial<AiStages> = {}): AiStages {
  return {
    available: true,
    rule: {
      resolvedCasesToAsk: 10,
      askedCasesToProposeTools: 20,
      toolUsePercentToShadow: 70,
      toolCasesMinimum: 10,
      draftWindow: 100,
      draftAsIsPercentForAgent: 80,
      minorEditPermille: 150,
    },
    types: [
      makeTypeStage('unrecognized_charge', 3, 'active'),
      makeTypeStage('undue_charge', 3, 'ready'),
      makeTypeStage('app_issue', 2),
      makeTypeStage('branch_service', 1),
      makeTypeStage('service_quality', 1),
      makeTypeStage('virtual_card', 0),
    ],
    ...overrides,
  }
}
