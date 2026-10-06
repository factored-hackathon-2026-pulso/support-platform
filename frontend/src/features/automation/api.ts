/**
 * Automatización calls (slice 22, docs/platform/api/slice-22-automation.md): the AI stages per case
 * type (slice 21), moving a type back and activating its agent, and the agent builder on
 * agent-core's registry (slice 16): proposals, their life, releases, aliases, versions and the
 * chat with the builder agent. The only module of the feature that talks to the API client; tests
 * mock it with `vi.mock('@/features/automation/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type {
  ActivateAgentResult,
  AgentAvatarKey,
  AgentProfile,
  AliasState,
  BuilderExchange,
  BuilderStatus,
  BuilderThread,
  CandidateView,
  EvalReport,
  MaturingType,
  MoveStageBackResult,
  Proposal,
  ProposalDetail,
  ProposalList,
  ProposalRecord,
  ProposalSummary,
  ReasonCode,
  ReleaseDetail,
  ValidationReport,
  VersionList,
} from './types'

export const automationKeys = {
  all: ['automation'] as const,
  /** GET /builder/status: whether the builder exists and how the code is asked. */
  status: () => ['automation', 'status'] as const,
  /** GET /builder/proposals (the platform's index, refreshed from the registry). */
  proposals: () => ['automation', 'proposals'] as const,
  /** GET /builder/proposals/{id}: the draft, the last evaluation and the review. */
  proposal: (proposalId: string) => ['automation', 'proposal', proposalId] as const,
  /**
   * GET /builder/proposals/{id}/record: the engine's dossier and the decisions' history. Under
   * the proposal's key, so whatever refreshes the proposal refreshes it too.
   */
  record: (proposalId: string) => ['automation', 'proposal', proposalId, 'record'] as const,
  /** GET /builder/aliases/{agentId}/{alias}. */
  alias: (agentId: string, alias: string) => ['automation', 'alias', agentId, alias] as const,
  /** GET /builder/releases/{releaseId}. */
  release: (releaseId: string) => ['automation', 'release', releaseId] as const,
  /** GET /builder/versions/agent/{agentId}. */
  versions: (agentId: string) => ['automation', 'versions', agentId] as const,
  /** GET /supervision/ai/agents/{agentId}: what Supervisión set for the agent (its photo). */
  agent: (agentId: string) => ['automation', 'agent', agentId] as const,
  /** GET /builder/chat: her thread with the builder agent. */
  chat: () => ['automation', 'chat'] as const,
}

export const automationMutationKeys = {
  moveBack: (caseType: string) => ['automation', 'move-back', caseType] as const,
  avatar: (agentId: string) => ['automation', 'avatar', agentId] as const,
  activate: (caseType: string) => ['automation', 'activate', caseType] as const,
  proposal: (proposalId: string) => ['automation', 'proposal', proposalId, 'step'] as const,
  ask: () => ['automation', 'chat', 'ask'] as const,
}

/** POST /supervision/ai/stages/{caseType}/move-back (a desired state; slice 21). */
export async function moveStageBack(
  caseType: MaturingType,
  toStage: number,
): Promise<MoveStageBackResult> {
  return unwrap(
    api.POST('/api/v1/supervision/ai/stages/{caseType}/move-back', {
      params: { path: { caseType } },
      body: { toStage },
    }),
  )
}

/**
 * POST /supervision/ai/stages/{caseType}/agent ("Activar", slice 22): promotes the agent's `prod`
 * alias to the published release (her authenticator code) and records that it serves the type.
 */
export async function activateTypeAgent(
  caseType: MaturingType,
  body: { agentId: string; releaseId: string; stepUpCode: string },
): Promise<ActivateAgentResult> {
  return unwrap(
    api.POST('/api/v1/supervision/ai/stages/{caseType}/agent', {
      params: { path: { caseType } },
      body,
    }),
  )
}

/** GET /supervision/ai/agents/{agentId}: the photo picked for the agent (null: none yet). */
export async function fetchAgentProfile(
  agentId: string,
  signal?: AbortSignal,
): Promise<AgentProfile> {
  return unwrap(
    api.GET('/api/v1/supervision/ai/agents/{agentId}', { params: { path: { agentId } }, signal }),
  )
}

/** PUT /supervision/ai/agents/{agentId}/avatar: the photo of an agent, also before it serves. */
export async function setAgentAvatar(agentId: string, avatar: AgentAvatarKey): Promise<void> {
  await unwrap(
    api.PUT('/api/v1/supervision/ai/agents/{agentId}/avatar', {
      params: { path: { agentId } },
      body: { avatar },
    }),
  )
}

/** GET /builder/status. Always 200: `available: false` hides everything of the builder. */
export async function fetchBuilderStatus(signal?: AbortSignal): Promise<BuilderStatus> {
  return unwrap(api.GET('/api/v1/builder/status', { signal }))
}

/** GET /builder/proposals (newest first, at most 50, each row re-read from the registry). */
export async function fetchProposals(signal?: AbortSignal): Promise<ProposalList> {
  return unwrap(api.GET('/api/v1/builder/proposals', { signal }))
}

/** POST /builder/proposals/track: bring a proposal agent-core already has into the list. */
export async function trackProposal(proposalId: string): Promise<ProposalSummary> {
  return unwrap(api.POST('/api/v1/builder/proposals/track', { body: { proposalId } }))
}

export async function fetchProposal(
  proposalId: string,
  signal?: AbortSignal,
): Promise<ProposalDetail> {
  return unwrap(
    api.GET('/api/v1/builder/proposals/{proposalId}', {
      params: { path: { proposalId } },
      signal,
    }),
  )
}

/**
 * GET …/record: what the platform keeps about the proposal, without agent-core: the improvement
 * engine's dossier (null when it did not announce it) with its evidence cases resolved, and the
 * history of the decisions taken here (oldest first).
 */
export async function fetchProposalRecord(
  proposalId: string,
  signal?: AbortSignal,
): Promise<ProposalRecord> {
  return unwrap(
    api.GET('/api/v1/builder/proposals/{proposalId}/record', {
      params: { path: { proposalId } },
      signal,
    }),
  )
}

/** POST …/validate: always 200; `violations: []` means it can be frozen. */
export async function validateProposal(proposalId: string): Promise<ValidationReport> {
  return unwrap(
    api.POST('/api/v1/builder/proposals/{proposalId}/validate', {
      params: { path: { proposalId } },
    }),
  )
}

/** POST …/freeze: the draft becomes a candidate (422 `registry_validation_failed` otherwise). */
export async function freezeProposal(proposalId: string): Promise<CandidateView> {
  return unwrap(
    api.POST('/api/v1/builder/proposals/{proposalId}/freeze', {
      params: { path: { proposalId } },
    }),
  )
}

/** POST …/reopen: back to `draft` to edit. */
export async function reopenProposal(proposalId: string): Promise<Proposal> {
  return unwrap(
    api.POST('/api/v1/builder/proposals/{proposalId}/reopen', {
      params: { path: { proposalId } },
    }),
  )
}

/**
 * POST …/evaluate: runs the agent's evaluation suite (it waits: seconds to minutes). A failed
 * gate is 409 `registry_gate_failed` with the report; no suite is 404 `registry_not_found`.
 */
export async function evaluateProposal(
  proposalId: string,
  body: { suiteId: string; suiteVersion?: string | null },
): Promise<EvalReport> {
  return unwrap(
    api.POST('/api/v1/builder/proposals/{proposalId}/evaluate', {
      params: { path: { proposalId } },
      body,
    }),
  )
}

/**
 * POST …/approve-and-publish: the one "Aprobar" (approve, then publish, one code). One key per
 * decision she means to make; a retry with it only repeats the publication.
 */
export async function approveAndPublishProposal(
  proposalId: string,
  body: {
    candidateHash: string
    acceptYardstickLoosened: boolean
    stepUpCode: string
    idempotencyKey: string
  },
): Promise<ReleaseDetail> {
  return unwrap(
    api.POST('/api/v1/builder/proposals/{proposalId}/approve-and-publish', {
      params: { path: { proposalId }, header: { 'Idempotency-Key': body.idempotencyKey } },
      body: {
        candidateHash: body.candidateHash,
        acceptYardstickLoosened: body.acceptYardstickLoosened,
        stepUpCode: body.stepUpCode,
      },
    }),
  )
}

/** POST …/reject: back to draft; `reasonCode` is agent-core's closed list (its PR 53). */
export async function rejectProposal(
  proposalId: string,
  body: { reason: string; stepUpCode: string; reasonCode?: ReasonCode | null },
): Promise<Proposal> {
  return unwrap(
    api.POST('/api/v1/builder/proposals/{proposalId}/reject', {
      params: { path: { proposalId } },
      body,
    }),
  )
}

/** POST /builder/aliases/{agentId}/{alias}/promote (here: `prod` back to an earlier release). */
export async function promoteAlias(
  agentId: string,
  alias: 'staging' | 'prod',
  body: { releaseId: string; reason: string; stepUpCode: string },
): Promise<unknown> {
  return unwrap(
    api.POST('/api/v1/builder/aliases/{agentId}/{alias}/promote', {
      params: { path: { agentId, alias } },
      body,
    }),
  )
}

/** GET /builder/aliases/{agentId}/{alias}; 404 `registry_not_found` when it points nowhere. */
export async function fetchAlias(
  agentId: string,
  alias: 'staging' | 'prod',
  signal?: AbortSignal,
): Promise<AliasState> {
  return unwrap(
    api.GET('/api/v1/builder/aliases/{agentId}/{alias}', {
      params: { path: { agentId, alias } },
      signal,
    }),
  )
}

export async function fetchRelease(
  releaseId: string,
  signal?: AbortSignal,
): Promise<ReleaseDetail> {
  return unwrap(
    api.GET('/api/v1/builder/releases/{releaseId}', { params: { path: { releaseId } }, signal }),
  )
}

/** GET /builder/versions/agent/{agentId}: the agent entity's versions, oldest first. */
export async function fetchAgentVersions(
  agentId: string,
  signal?: AbortSignal,
): Promise<VersionList> {
  return unwrap(
    api.GET('/api/v1/builder/versions/{kind}/{entityId}', {
      params: { path: { kind: 'agent', entityId: agentId } },
      signal,
    }),
  )
}

/** GET /builder/chat: her thread (`available: false` without agent-core). */
export async function fetchBuilderChat(signal?: AbortSignal): Promise<BuilderThread> {
  return unwrap(api.GET('/api/v1/builder/chat', { signal }))
}

/**
 * POST /builder/chat/messages: waits for the builder agent. Idempotent on `clientMessageId`
 * (= `Idempotency-Key`): after a failure the same id asks again.
 */
export async function askBuilder(body: {
  text: string
  clientMessageId: string
}): Promise<BuilderExchange> {
  return unwrap(
    api.POST('/api/v1/builder/chat/messages', {
      params: { header: { 'Idempotency-Key': body.clientMessageId } },
      body,
    }),
  )
}

/** POST /builder/chat/restart ("Nueva conversación", slice 22): an empty thread, a new run. */
export async function restartBuilderChat(): Promise<BuilderThread> {
  return unwrap(api.POST('/api/v1/builder/chat/restart'))
}
