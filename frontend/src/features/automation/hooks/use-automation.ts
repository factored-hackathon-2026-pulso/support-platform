import { useCallback, useState } from 'react'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useAiEnabled } from '@/app/platform'
import { copilotKeys } from '@/features/copilot/core'
import { isApiProblem, type ApiProblem } from '@/lib/api'
import {
  activateTypeAgent,
  setAgentAvatar,
  approveAndPublishProposal,
  askBuilder,
  automationKeys,
  automationMutationKeys,
  evaluateProposal,
  fetchAgentVersions,
  fetchAlias,
  fetchBuilderChat,
  fetchBuilderStatus,
  fetchProposal,
  fetchProposalRecord,
  fetchProposals,
  fetchRelease,
  freezeProposal,
  moveStageBack,
  promoteAlias,
  rejectProposal,
  reopenProposal,
  restartBuilderChat,
  trackProposal,
  validateProposal,
} from '../api'
import {
  describeChatFailure,
  newClientMessageId,
  newProposals,
  type AgentRequest,
  type PendingMessage,
} from '../builder-chat'
import type {
  AgentAvatarKey,
  AliasState,
  BuilderExchange,
  BuilderStatus,
  BuilderThread,
  MaturingType,
  ProposalDetail,
  ProposalList,
  ProposalRecord,
  ReasonCode,
  ReleaseDetail,
  VersionList,
} from '../types'

/** How often the status is asked again while the agents service is down (to notice it is back). */
export const UNREACHABLE_RECHECK_MS = 15_000

/**
 * GET /builder/status while AI is on (`available: false` without agent-core). While agent-core is
 * down (`reachable: false`) it is asked again every few seconds, so the screen recovers by itself.
 */
export function useBuilderStatus(): UseQueryResult<BuilderStatus, ApiProblem> {
  const aiEnabled = useAiEnabled()
  return useQuery<BuilderStatus, ApiProblem>({
    queryKey: automationKeys.status(),
    queryFn: ({ signal }) => fetchBuilderStatus(signal),
    enabled: aiEnabled,
    staleTime: 60_000,
    refetchInterval: (query) =>
      isAgentsServiceDown(query.state.data) ? UNREACHABLE_RECHECK_MS : false,
  })
}

/** Whether the builder answers (AI on and agent-core wired). */
export function useBuilderAvailable(): boolean {
  return useBuilderStatus().data?.available === true
}

/** Agent-core is wired but down (deploy brief P4): "el servicio de agentes no está disponible". */
export function isAgentsServiceDown(status: BuilderStatus | undefined): boolean {
  return status?.available === true && status.reachable === false
}

/** Whether the agents service is down right now (see `isAgentsServiceDown`). */
export function useAgentsServiceDown(): boolean {
  return isAgentsServiceDown(useBuilderStatus().data)
}

/**
 * The proposals list (the platform's index, each row re-read from the registry). States change
 * through the chat, the improvement engine or another person: it is read again on focus.
 */
export function useProposals({ enabled = true }: { enabled?: boolean } = {}): UseQueryResult<
  ProposalList,
  ApiProblem
> {
  return useQuery<ProposalList, ApiProblem>({
    queryKey: automationKeys.proposals(),
    queryFn: ({ signal }) => fetchProposals(signal),
    enabled,
    refetchOnWindowFocus: true,
  })
}

export function useProposal(proposalId: string): UseQueryResult<ProposalDetail, ApiProblem> {
  return useQuery<ProposalDetail, ApiProblem>({
    queryKey: automationKeys.proposal(proposalId),
    queryFn: ({ signal }) => fetchProposal(proposalId, signal),
    refetchOnWindowFocus: true,
  })
}

/** The engine's dossier and the decisions' history (local reads: no agent-core call). */
export function useProposalRecord(proposalId: string): UseQueryResult<ProposalRecord, ApiProblem> {
  return useQuery<ProposalRecord, ApiProblem>({
    queryKey: automationKeys.record(proposalId),
    queryFn: ({ signal }) => fetchProposalRecord(proposalId, signal),
    refetchOnWindowFocus: true,
  })
}

/** An alias of an agent, or null when it points nowhere (404 `registry_not_found`). */
async function aliasOrNull(
  agentId: string,
  alias: 'staging' | 'prod',
  signal?: AbortSignal,
): Promise<AliasState | null> {
  try {
    return await fetchAlias(agentId, alias, signal)
  } catch (error) {
    if (isApiProblem(error, 'registry_not_found')) return null
    throw error
  }
}

export function useAlias(
  agentId: string | null,
  alias: 'staging' | 'prod',
): UseQueryResult<AliasState | null, ApiProblem> {
  return useQuery<AliasState | null, ApiProblem>({
    queryKey: automationKeys.alias(agentId ?? '', alias),
    queryFn: ({ signal }) => aliasOrNull(agentId ?? '', alias, signal),
    enabled: agentId !== null && agentId !== '',
  })
}

export function useRelease(releaseId: string | null): UseQueryResult<ReleaseDetail, ApiProblem> {
  return useQuery<ReleaseDetail, ApiProblem>({
    queryKey: automationKeys.release(releaseId ?? ''),
    queryFn: ({ signal }) => fetchRelease(releaseId ?? '', signal),
    enabled: releaseId !== null && releaseId !== '',
    staleTime: Infinity, // a release never changes (only its status, through revoke)
  })
}

export function useAgentVersions(agentId: string): UseQueryResult<VersionList, ApiProblem> {
  return useQuery<VersionList, ApiProblem>({
    queryKey: automationKeys.versions(agentId),
    queryFn: ({ signal }) => fetchAgentVersions(agentId, signal),
  })
}

export interface AgentAliases {
  agentId: string
  prod: AliasState | null | undefined
  staging: AliasState | null | undefined
  /** The registry did not answer for this agent. */
  failed: boolean
  /** Still asking the registry: the status is not known yet (not "no data"). */
  pending: boolean
}

/** Both aliases of several agents (the agents list). */
export function useAgentsAliases(agentIds: readonly string[], enabled: boolean): AgentAliases[] {
  const results = useQueries({
    queries: agentIds.flatMap((agentId) =>
      (['prod', 'staging'] as const).map((alias) => ({
        queryKey: automationKeys.alias(agentId, alias),
        queryFn: ({ signal }: { signal?: AbortSignal }) => aliasOrNull(agentId, alias, signal),
        enabled,
      })),
    ),
  })
  return agentIds.map((agentId, index) => {
    const prod = results[index * 2]
    const staging = results[index * 2 + 1]
    return {
      agentId,
      prod: prod?.data,
      staging: staging?.data,
      failed: Boolean(prod?.isError || staging?.isError),
      pending: enabled && Boolean(prod?.isPending || staging?.isPending),
    }
  })
}

/** The releases of several ids (the agents list: the version in production). */
export function useReleases(releaseIds: readonly string[]): Map<string, ReleaseDetail> {
  const results = useQueries({
    queries: releaseIds.map((releaseId) => ({
      queryKey: automationKeys.release(releaseId),
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchRelease(releaseId, signal),
      staleTime: Infinity,
    })),
  })
  const found = new Map<string, ReleaseDetail>()
  results.forEach((result, index) => {
    const id = releaseIds[index]
    if (id && result.data) found.set(id, result.data)
  })
  return found
}

/** Refresh what a registry step changes: the proposal, the list, the aliases and the stages. */
function useRefreshAfterStep() {
  const queryClient = useQueryClient()
  return useCallback(
    (proposalId?: string) => {
      if (proposalId) {
        void queryClient.invalidateQueries({ queryKey: automationKeys.proposal(proposalId) })
      }
      void queryClient.invalidateQueries({ queryKey: automationKeys.proposals() })
      void queryClient.invalidateQueries({ queryKey: ['automation', 'alias'] })
      void queryClient.invalidateQueries({ queryKey: copilotKeys.stages() })
    },
    [queryClient],
  )
}

/** POST …/move-back: the stages follow (the answer, and `ai.stage_updated` for everyone). */
export function useMoveStageBack(caseType: MaturingType) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: automationMutationKeys.moveBack(caseType),
    mutationFn: (toStage: number) => moveStageBack(caseType, toStage),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: copilotKeys.stages() }),
  })
}

export type ProposalStep =
  | { kind: 'validate' }
  | { kind: 'freeze' }
  | { kind: 'reopen' }
  | { kind: 'evaluate'; suiteId: string; suiteVersion: string | null }
  | {
      kind: 'approve'
      candidateHash: string
      acceptYardstickLoosened: boolean
      stepUpCode: string
      idempotencyKey: string
    }
  | { kind: 'reject'; reason: string; reasonCode: ReasonCode; stepUpCode: string }

async function runStep(proposalId: string, step: ProposalStep): Promise<unknown> {
  switch (step.kind) {
    case 'validate':
      return validateProposal(proposalId)
    case 'freeze':
      return freezeProposal(proposalId)
    case 'reopen':
      return reopenProposal(proposalId)
    case 'evaluate':
      return evaluateProposal(proposalId, {
        suiteId: step.suiteId,
        suiteVersion: step.suiteVersion,
      })
    case 'approve':
      return approveAndPublishProposal(proposalId, {
        candidateHash: step.candidateHash,
        acceptYardstickLoosened: step.acceptYardstickLoosened,
        stepUpCode: step.stepUpCode,
        idempotencyKey: step.idempotencyKey,
      })
    case 'reject':
      return rejectProposal(proposalId, {
        reason: step.reason,
        reasonCode: step.reasonCode,
        stepUpCode: step.stepUpCode,
      })
  }
}

/** One step of the proposal's life; the proposal and the list are read again after it. */
export function useProposalStep(proposalId: string) {
  const refresh = useRefreshAfterStep()
  return useMutation({
    mutationKey: automationMutationKeys.proposal(proposalId),
    mutationFn: (step: ProposalStep) => runStep(proposalId, step),
    // A failed gate also moves the proposal (back to draft): read it again either way.
    onSettled: (_data, _error, step) => {
      if (step.kind !== 'validate') refresh(proposalId)
    },
  })
}

/** POST /supervision/ai/stages/{caseType}/agent ("Activar"). */
export function useActivateAgent(caseType: MaturingType | null) {
  const refresh = useRefreshAfterStep()
  return useMutation({
    mutationKey: automationMutationKeys.activate(caseType ?? ''),
    mutationFn: (body: { agentId: string; releaseId: string; stepUpCode: string }) =>
      activateTypeAgent(caseType ?? 'undue_charge', body),
    onSettled: () => refresh(),
  })
}

/** PUT /supervision/ai/stages/{caseType}/agent/avatar (the stages are read again). */
export function useSetAgentAvatar(caseType: MaturingType | null) {
  const refresh = useRefreshAfterStep()
  return useMutation({
    mutationKey: automationMutationKeys.avatar(caseType ?? ''),
    mutationFn: (avatar: AgentAvatarKey) => setAgentAvatar(caseType ?? 'undue_charge', avatar),
    onSettled: () => refresh(),
  })
}

/** POST /builder/proposals/track. */
export function useTrackProposal() {
  const refresh = useRefreshAfterStep()
  return useMutation({
    mutationFn: (proposalId: string) => trackProposal(proposalId),
    onSuccess: () => refresh(),
  })
}

/**
 * Point `prod` at a release with her code: "Volver a la versión anterior" (the release the current
 * one was based on) or "Pasar a producción" (the one `staging` points at, or a proposal's own
 * release; `proposalId` then refreshes that proposal's page and history).
 */
export function usePromoteProd(agentId: string, proposalId?: string) {
  const refresh = useRefreshAfterStep()
  return useMutation({
    mutationFn: (body: { releaseId: string; stepUpCode: string }) =>
      promoteAlias(agentId, 'prod', { ...body, reason: '' }),
    onSettled: () => refresh(proposalId),
  })
}

/** GET /builder/chat (her thread), while the builder is there. */
export function useBuilderChat(enabled: boolean): UseQueryResult<BuilderThread, ApiProblem> {
  return useQuery<BuilderThread, ApiProblem>({
    queryKey: automationKeys.chat(),
    queryFn: ({ signal }) => fetchBuilderChat(signal),
    enabled,
  })
}

export interface BuilderAsk {
  /** The message on its way or failed (kept for "Reintentar"). */
  pending: PendingMessage | null
  /** The proposals the last answer made or named. */
  proposals: BuilderExchange['proposals']
  send(text: string): void
  /**
   * Send and wait for the answer ("Proponer un agente" answers the builder's questions in
   * order): the exchange, or null when it failed (the message stays for "Reintentar").
   */
  sendAndWait(text: string): Promise<BuilderExchange | null>
  /** Offer these proposals ("Abrir propuesta"), e.g. the ones the builder made unnamed. */
  showProposals(proposals: BuilderExchange['proposals']): void
  retry(): void
  /** Forget the message in flight and the proposals (a new conversation). */
  clear(): void
  sending: boolean
}

/**
 * Talk to the builder agent: one message at a time; a failed one keeps its `clientMessageId` so
 * "Reintentar" asks again without asking twice (slice 16 §4).
 */
export function useAskBuilder(): BuilderAsk {
  const queryClient = useQueryClient()
  const refresh = useRefreshAfterStep()
  const [pending, setPending] = useState<PendingMessage | null>(null)
  const [proposals, setProposals] = useState<BuilderExchange['proposals']>([])
  const mutation = useMutation({
    mutationKey: automationMutationKeys.ask(),
    mutationFn: (message: { text: string; clientMessageId: string }) => askBuilder(message),
    onSuccess: (exchange) => {
      queryClient.setQueryData<BuilderThread>(automationKeys.chat(), (current) => {
        const messages = (current?.messages ?? []).filter((m) => m.id !== exchange.message.id)
        return {
          available: true,
          messages: [...messages, exchange.message, ...exchange.answers],
          awaiting: exchange.awaiting,
        }
      })
      setPending(null)
      setProposals(exchange.proposals)
      if (exchange.proposals.length > 0) refresh()
    },
    onError: (error, message) => {
      setPending({ ...message, status: 'failed', failure: describeChatFailure(error) })
    },
  })
  const ask = useCallback(
    (message: { text: string; clientMessageId: string }) => {
      setPending({ ...message, status: 'sending' })
      mutation.mutate(message)
    },
    [mutation],
  )
  const { mutateAsync } = mutation
  const sendAndWait = useCallback(
    async (text: string): Promise<BuilderExchange | null> => {
      const message = { text, clientMessageId: newClientMessageId() }
      setProposals([])
      setPending({ ...message, status: 'sending' })
      try {
        return await mutateAsync(message)
      } catch {
        return null // onError kept it as failed, for "Reintentar"
      }
    },
    [mutateAsync],
  )
  return {
    pending,
    proposals,
    sending: mutation.isPending,
    send: (text) => {
      if (mutation.isPending) return
      setProposals([])
      ask({ text, clientMessageId: newClientMessageId() })
    },
    sendAndWait,
    showProposals: setProposals,
    retry: () => {
      if (!pending || mutation.isPending) return
      ask({ text: pending.text, clientMessageId: pending.clientMessageId })
    },
    clear: () => {
      setPending(null)
      setProposals([])
    },
  }
}

export type ProposeOutcome = 'done' | 'stopped' | 'failed'

export interface ProposeAgent {
  /**
   * Answer `constructor-chat`'s questions in its order: the agent id, then (only if it asks for
   * the next datum) the goal. `stopped`: it did not ask for the goal; `failed`: a message got no
   * answer (it stays for "Reintentar").
   */
  run(request: AgentRequest): Promise<ProposeOutcome>
  running: boolean
}

/**
 * "Proponer un agente" in the builder's format (slice 22). Its answer names no proposal, so the
 * proposals list (agent-core's own, merged) is read before and after: what is new for that agent
 * is offered as "Abrir propuesta".
 */
export function useProposeAgent(ask: BuilderAsk): ProposeAgent {
  const queryClient = useQueryClient()
  const [running, setRunning] = useState(false)
  const { sendAndWait, showProposals } = ask
  const run = useCallback(
    async (request: AgentRequest): Promise<ProposeOutcome> => {
      setRunning(true)
      try {
        const before = await fetchProposals()
          .then((list) => new Set(list.items.map((p) => p.proposalId)))
          .catch(() => null)
        const agent = await sendAndWait(request.agentId)
        if (agent === null) return 'failed'
        if (agent.awaiting !== 'slot') return 'stopped'
        const goal = await sendAndWait(request.goal)
        if (goal === null) return 'failed'
        void queryClient.invalidateQueries({ queryKey: automationKeys.proposals() })
        if (goal.proposals.length === 0) {
          const after = await fetchProposals().catch(() => null)
          const made = after ? newProposals(before, after.items, request.agentId) : []
          if (made.length > 0) showProposals(made)
        }
        return 'done'
      } finally {
        setRunning(false)
      }
    },
    [queryClient, sendAndWait, showProposals],
  )
  return { run, running }
}

/** "Nueva conversación": an empty thread; the next message starts another run. */
export function useRestartBuilderChat() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => restartBuilderChat(),
    onSuccess: (thread) => queryClient.setQueryData(automationKeys.chat(), thread),
  })
}
