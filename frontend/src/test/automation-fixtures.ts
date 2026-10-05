/**
 * The agent builder's answers (slice 16) as "Automatización" reads them (slice 22). Agent ids
 * follow agent-core's demo (`disputas`) and the suggested `cobros`; nothing here is a dataset record.
 */
import type {
  AliasState,
  BuilderMessage,
  BuilderStatus,
  EntityDraft,
  EvalReport,
  Proposal,
  ProposalDetail,
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
}

export const BUILDER_OFF: BuilderStatus = {
  available: false,
  canApprove: false,
  canRevoke: false,
  stepUpMethod: null,
  stepUpDigits: null,
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
    ...overrides,
  }
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
