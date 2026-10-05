/**
 * Pure rules of the agents list and of one agent (IaAutomatizacion `agentes` and `agente`, slice
 * 22). agent-core's registry has no agent catalog (slice 16 §8): the agents are the ones that serve
 * a case type (the stages' `agentId`) and the ones proposals are for (the platform's index). No
 * React, no I/O: agents.test.ts.
 */
import type { StatusAppearance } from '@/components/ui'
import { i18n } from '@/lib/i18n'
import { agentVersionIn } from './proposals'
import { isMaturing } from './model'
import type { AiStages, AliasState, MaturingType, ProposalSummary, ReleaseDetail } from './types'

const t = i18n.getFixedT(null, 'automation')

/** The agents to list: the ones serving a type first, then the ones proposals are for. */
export function agentIds(
  stages: AiStages | undefined,
  proposals: readonly ProposalSummary[],
): string[] {
  const serving = (stages?.available ? stages.types : [])
    .filter((entry) => entry.agent === 'active' && entry.agentId)
    .map((entry) => entry.agentId as string)
  const proposed = proposals.map((proposal) => proposal.agentId)
  return [...new Set([...serving, ...proposed])]
}

export type AgentRunStatus = 'prod' | 'staging' | 'none' | 'unknown'

/** Where an agent runs: `prod` points somewhere, only `staging`, nowhere, or unknown. */
export function agentRunStatus(
  prod: AliasState | null | undefined,
  staging: AliasState | null | undefined,
): AgentRunStatus {
  if (prod === undefined && staging === undefined) return 'unknown'
  if (prod && prod.status === 'active') return 'prod'
  if (staging && staging.status === 'active') return 'staging'
  return 'none'
}

const RUN_LOOK: Record<AgentRunStatus, Omit<StatusAppearance, 'label'>> = {
  prod: { shape: 'check', tone: 'success' },
  staging: { shape: 'pie-50', tone: 'accent' },
  none: { shape: 'dashed', tone: 'neutral' },
  unknown: { shape: 'ring', tone: 'neutral' },
}

export function agentRunAppearance(status: AgentRunStatus): StatusAppearance {
  return { ...RUN_LOOK[status], label: t(`agents.status.${status}`) }
}

export interface AgentRow {
  agentId: string
  serves: MaturingType[]
  status: AgentRunStatus
  /** The agent's version in production (or in staging when it only runs there). */
  version: string | null
}

export function agentRow(
  agentId: string,
  stages: AiStages | undefined,
  aliases: { prod: AliasState | null | undefined; staging: AliasState | null | undefined },
  releases: ReadonlyMap<string, ReleaseDetail>,
): AgentRow {
  const status = agentRunStatus(aliases.prod, aliases.staging)
  const shown = aliases.prod ?? aliases.staging ?? null
  return {
    agentId,
    serves: servedTypes(stages, agentId),
    status,
    version: shown ? agentVersionIn(releases.get(shown.releaseId)) : null,
  }
}

/** The types an agent serves (the stages' `agentId` while `active`). */
export function servedTypes(stages: AiStages | undefined, agentId: string): MaturingType[] {
  if (!stages?.available) return []
  return stages.types
    .filter((entry) => entry.agent === 'active' && entry.agentId === agentId)
    .map((entry) => entry.caseType)
    .filter(isMaturing)
}

/**
 * "Volver a la versión anterior": the release `prod` was based on, when the release it points at
 * has one (a real alias rollback in the registry). Null for a first version.
 */
export function rollbackTarget(prodRelease: ReleaseDetail | null | undefined): string | null {
  return prodRelease?.baseReleaseId ?? null
}

/**
 * "Pasar a producción": the release `staging` points at when `prod` points elsewhere (a newer
 * version published for an agent that already runs). Null when they match or nothing is staged.
 */
export function promotionTarget(
  prod: AliasState | null | undefined,
  staging: AliasState | null | undefined,
): string | null {
  if (!staging || staging.status !== 'active') return null
  return prod?.releaseId === staging.releaseId ? null : staging.releaseId
}

/** Newest version first (the registry lists them oldest first). */
export function newestFirst<T>(items: readonly T[]): T[] {
  return [...items].reverse()
}
