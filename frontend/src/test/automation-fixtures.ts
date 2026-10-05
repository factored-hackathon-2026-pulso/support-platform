/**
 * The agent builder's answers (slice 16) as "Automatización" reads them (slice 22). Agent ids
 * follow agent-core's demo (`disputas`) and the suggested `cobros`; nothing here is a dataset record.
 */
import type {
  AliasState,
  BuilderExchange,
  BuilderMessage,
  BuilderStatus,
  BuilderThread,
  EntityDraft,
  EvalReport,
  EvidenceCase,
  Proposal,
  ProposalDetail,
  ProposalHistoryEntry,
  ProposalImprovement,
  ProposalList,
  ProposalRecord,
  ProposalSummary,
  ReleaseDetail,
} from '@/features/automation'

export const PROPOSAL_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
export const RELEASE_ID = 'rel-5d1f0a9c3b2e4f6a'
export const BASE_RELEASE_ID = 'rel-2a99d62f9ffa101c'

export const BUILDER_ON: BuilderStatus = {
  available: true,
  canApprove: true,
  canRevoke: false,
  stepUpMethod: 'authenticator',
  stepUpDigits: 6,
  reachable: true,
}

export const BUILDER_OFF: BuilderStatus = {
  available: false,
  canApprove: false,
  canRevoke: false,
  stepUpMethod: null,
  stepUpDigits: null,
  reachable: true,
}

export function makeChange(overrides: Partial<EntityDraft> = {}): EntityDraft {
  return {
    kind: 'template',
    content: { id: 't/resumen', version: '1.1.0', text: 'corto' },
    docs: {
      description: 'Acorta el resumen',
      rationale: 'Se lee mejor',
      changelog: 'Máximo 3 líneas',
    },
    ...overrides,
  }
}

export function makeEvalReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    verdict: 'pass',
    items: [
      {
        metricId: 'resuelve_sin_persona',
        phase: 'new_yardstick',
        role: 'gate',
        value: '0.92',
        baseValue: '0.90',
        noiseMargin: '0.02',
        floor: '0.85',
        passed: true,
        reason: 'Sobre el mínimo',
      },
      {
        metricId: 'traspaso_a_tiempo',
        phase: 'platform',
        role: 'guardrail',
        value: '0.70',
        baseValue: null,
        noiseMargin: null,
        floor: '0.80',
        passed: false,
        reason: 'Bajo el mínimo',
      },
    ],
    yardstickChanges: [],
    detail: null,
    runs: null,
    results: [],
    judgeNotes: [],
    ...overrides,
  }
}

export function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    proposalId: PROPOSAL_ID,
    agentId: 'cobros',
    origin: 'builder_chat',
    state: 'draft',
    rev: 1,
    baseReleaseId: null,
    title: 'Agente para Cobro indebido',
    createdBy: 'svc:constructor',
    candidateHash: null,
    updatedAt: '2026-10-05T14:00:00Z',
    ...overrides,
  }
}

export function makeProposalDetail(
  proposal: Partial<Proposal> = {},
  overrides: Partial<ProposalDetail> = {},
): ProposalDetail {
  return {
    proposal: makeProposal(proposal),
    changes: [
      makeChange({
        kind: 'agent',
        content: {
          id: 'cobros',
          version: '1.0.0',
          tools_allowed: ['leer_movimientos@1', 'leer_productos@1'],
          supported_locales: ['es', 'pt'],
        },
        docs: {
          description: 'Atiende los cobros indebidos',
          rationale: 'El tipo completó las tres etapas',
          changelog: 'Primera versión',
        },
      }),
      makeChange(),
    ],
    lastEval: null,
    review: null,
    lastDecision: null,
    ...overrides,
  }
}

/** The engine's dossier as the platform keeps it (ADR 0007); synthetic text and case ids. */
export const EVIDENCE_CASE_ID = 'CASE-01KA0000000000000000000101'
export const GONE_CASE_ID = 'CASE-00000000000000000000000000'

export function makeEvidenceCase(overrides: Partial<EvidenceCase> = {}): EvidenceCase {
  return {
    caseId: EVIDENCE_CASE_ID,
    available: true,
    status: 'closed',
    caseType: 'unrecognized_charge',
    channel: 'chat_app',
    language: 'es',
    openedAt: '2026-10-01T14:00:00Z',
    ...overrides,
  }
}

export function makeImprovement(overrides: Partial<ProposalImprovement> = {}): ProposalImprovement {
  return {
    title: 'Disputas: confirmar el cargo antes de pedir el comprobante',
    problem:
      'Los clientes con un cargo no reconocido escalan más por chat.\nEl paso de confirmación falta.',
    evidence: 'Celda: 96 de 240 casos escalados frente a 48 de 240 en la base del mismo canal.',
    expectedEffect: 'Menos escalaciones en esta celda. Es una hipótesis, no una predicción.',
    language: 'es',
    announcedAt: '2026-10-05T12:00:00Z',
    evidenceCases: [
      makeEvidenceCase(),
      {
        caseId: GONE_CASE_ID,
        available: false,
        status: null,
        caseType: null,
        channel: null,
        language: null,
        openedAt: null,
      },
    ],
    ...overrides,
  }
}

export function makeHistoryEntry(
  kind: ProposalHistoryEntry['kind'],
  overrides: Partial<ProposalHistoryEntry> = {},
): ProposalHistoryEntry {
  return {
    kind,
    at: '2026-10-05T14:00:00Z',
    actorId: 'STF-00000000000000000000000005',
    actorName: 'Lucía Gómez',
    source: null,
    verdict: null,
    items: null,
    itemsFailed: null,
    suiteId: null,
    reasonCode: null,
    releaseId: null,
    alias: null,
    ...overrides,
  }
}

export function makeRecord(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return { improvement: null, history: [], ...overrides }
}

export function makeSummary(overrides: Partial<ProposalSummary> = {}): ProposalSummary {
  return {
    proposalId: PROPOSAL_ID,
    agentId: 'cobros',
    title: 'Agente para Cobro indebido',
    origin: 'builder_chat',
    state: 'draft',
    rev: 1,
    baseReleaseId: null,
    candidateHash: null,
    createdBy: 'svc:constructor',
    registeredBy: 'STF-00000000000000000000000005',
    source: 'chat',
    updatedAt: '2026-10-05T14:00:00Z',
    refreshedAt: '2026-10-05T14:00:00Z',
    live: true,
    ...overrides,
  }
}

export function makeRelease(overrides: Partial<ReleaseDetail> = {}): ReleaseDetail {
  return {
    releaseId: BASE_RELEASE_ID,
    status: 'active',
    agentId: 'disputas',
    entities: [
      {
        ref: { kind: 'agent', id: 'disputas', version: '1.0.0' },
        contentHash: 'abc',
        docs: { description: 'Importado', rationale: 'semilla', changelog: '' },
        changedVsBase: false,
      },
    ],
    knowledgeSnapshot: null,
    proposalId: null,
    baseReleaseId: null,
    publishedBy: 'root',
    publishedAt: '2026-09-28T15:00:00Z',
    evalSuiteRefs: [],
    interrupts: [],
    languageDetection: { id: 'lang-es-pt', version: '1.0.0' },
    injectionRuleset: null,
    maxInputChars: 4000,
    ...overrides,
  }
}

export function makeAlias(overrides: Partial<AliasState> = {}): AliasState {
  return {
    agentId: 'disputas',
    alias: 'prod',
    releaseId: BASE_RELEASE_ID,
    status: 'active',
    ...overrides,
  }
}

export function builderMessage(
  id: string,
  role: BuilderMessage['role'],
  text: string,
  answers: string | null = null,
): BuilderMessage {
  return { id, role, text, createdAt: '2026-10-05T14:00:00Z', answers }
}

/** `constructor-chat`'s questions and answers (agent-core's templates), as the fake says them. */
export const CONSTRUCTOR_TEXTS = {
  es: {
    askAgent: '¿Qué agente quieres modificar? (por ejemplo: disputas)',
    askGoal: 'Cuéntame qué cambio quieres en ese agente.',
    done: 'Dejé la propuesta en borrador. Revísala y apruébala en el registry.',
    handover: 'Te paso con un asesor.',
  },
  pt: {
    askAgent: 'Qual agente você quer modificar? (por exemplo: disputas)',
    askGoal: 'Conte-me qual mudança você quer nesse agente.',
    done: 'Deixei a proposta em rascunho. Revise-a e aprove-a no registry.',
    handover: 'Vou transferir para um atendente.',
  },
} as const

/**
 * A fake of `constructor-chat`'s flow `construir` behind the platform's chat API: "Nueva
 * conversación" starts a run that asks for the agent; each message answers the question asked,
 * verbatim (the agent, then the goal); with both it makes a proposal (agent-core's rules: a valid
 * agent id, a goal of at most 200 characters) that only the proposals list shows (its answer names
 * no id), else it hands over. Wire it with `vi.mocked(restartBuilderChat).mockImplementation(
 * builder.restart)`, the same for `askBuilder` and `fetchProposals`.
 */
export function scriptedConstructor(locale: 'es' | 'pt' = 'es') {
  const texts = CONSTRUCTOR_TEXTS[locale]
  const proposals: ProposalSummary[] = []
  const sent: string[] = []
  let asking: 'agent' | 'goal' | null = null
  let agentId = ''
  let count = 0
  const id = () => `bm-${++count}`
  const answer = (text: string, answers: string | null = null) =>
    builderMessage(id(), 'agent', text, answers)
  return {
    sent,
    proposals,
    restart: (): Promise<BuilderThread> => {
      asking = 'agent'
      return Promise.resolve({
        available: true,
        messages: [answer(texts.askAgent)],
        awaiting: 'slot',
      })
    },
    ask: ({ text }: { text: string; clientMessageId: string }): Promise<BuilderExchange> => {
      sent.push(text)
      const message = builderMessage(id(), 'person', text)
      const reply = (said: string, awaiting: BuilderExchange['awaiting']): BuilderExchange => ({
        message,
        answers: [answer(said, message.id)],
        proposals: [],
        replayed: false,
        awaiting,
      })
      if (asking === 'agent') {
        agentId = text
        asking = 'goal'
        return Promise.resolve(reply(texts.askGoal, 'slot'))
      }
      asking = null
      if (!/^[a-z0-9][a-z0-9_/-]*$/.test(agentId) || [...text].length > 200) {
        return Promise.resolve(reply(texts.handover, 'none'))
      }
      proposals.unshift(
        makeSummary({
          proposalId: `p-made-${proposals.length + 1}`,
          agentId,
          title: text,
          source: 'registry',
          registeredBy: null,
          createdBy: 'constructor-bot',
          rev: 1,
        }),
      )
      return Promise.resolve(reply(texts.done, 'none'))
    },
    list: (): Promise<ProposalList> =>
      Promise.resolve({ items: [...proposals], registryListed: true }),
  }
}
