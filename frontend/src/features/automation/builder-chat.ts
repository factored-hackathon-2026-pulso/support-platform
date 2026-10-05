/**
 * Pure rules of the chat with the builder agent (`constructor-chat`, slice 16; screens in slice
 * 22): the thread with the message in flight, the failures in words, and what "Proponer un
 * agente" sends (the agent id, then the goal). No React, no I/O: builder-chat.test.ts.
 */
import { isApiProblem } from '@/lib/api'
import { i18n } from '@/lib/i18n'
import { typeName } from './model'
import type {
  BuilderMessage,
  BuilderThread,
  CaseTypeStage,
  MaturingType,
  ProposalSummary,
} from './types'

const t = i18n.getFixedT(null, 'automation')

/** A message she sent that has no answer yet: on its way, or failed (kept for a retry). */
export interface PendingMessage {
  clientMessageId: string
  text: string
  status: 'sending' | 'failed'
  /** Why it failed, in words (status `failed`). */
  failure?: string
}

export type ChatEntry =
  | { kind: 'message'; key: string; message: BuilderMessage }
  | { kind: 'pending'; key: string; pending: PendingMessage }

/**
 * The thread as the panel shows it: the stored messages, then the one in flight (unless the
 * thread already has it, after a refetch).
 */
export function chatEntries(
  thread: BuilderThread | undefined,
  pending: PendingMessage | null,
): ChatEntry[] {
  const messages = thread?.messages ?? []
  const entries: ChatEntry[] = messages.map((message) => ({
    kind: 'message',
    key: message.id,
    message,
  }))
  if (pending) {
    const answered = messages.some(
      (m) => m.role === 'person' && m.text === pending.text && pending.status === 'sending',
    )
    if (!answered) entries.push({ kind: 'pending', key: pending.clientMessageId, pending })
  }
  return entries
}

/** What to tell her when a message did not get its answer. */
export function describeChatFailure(error: unknown): string {
  if (isApiProblem(error, 'builder_busy')) return t('chat.busy')
  if (isApiProblem(error, 'agent_core_rejected')) return t('chat.rejected')
  return t('chat.unavailable')
}

/**
 * agent-core's rule for an agent id (`Proposal.agent_id`): lowercase letters, digits, `-`, `_`
 * and `/`, starting with a letter or a digit ("cobros", "soporte-app").
 */
export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_/-]*$/

/** The goal becomes the proposal's title in agent-core: 1 to 200 characters. */
export const MAX_GOAL = 200

export function isValidAgentId(agentId: string): boolean {
  return AGENT_ID_PATTERN.test(agentId)
}

/** Characters as agent-core counts them (code points, not UTF-16 units). */
export function goalLength(goal: string): number {
  return [...goal].length
}

/** What "Proponer un agente" sends to the builder, one datum per question it asks. */
export interface AgentRequest {
  /** The answer to its first question (which agent): the id alone. */
  agentId: string
  /** The answer to its second question (what to change): at most `MAX_GOAL` characters. */
  goal: string
}

/** Cut a goal to `MAX_GOAL` characters at a word boundary (never mid-word when it can). */
export function fitGoal(goal: string): string {
  const text = goal.trim()
  const chars = [...text]
  if (chars.length <= MAX_GOAL) return text
  const cut = chars.slice(0, MAX_GOAL).join('')
  const space = cut.lastIndexOf(' ')
  return (space > MAX_GOAL / 2 ? cut.slice(0, space) : cut).trimEnd()
}

/**
 * "Proponer un agente" for a type, the way `constructor-chat` takes it (agent-core's flow
 * `construir` asks for the agent, then for the goal, and takes each answer verbatim): the agent
 * id alone, then a goal of at most 200 characters (it becomes the proposal's title), in the UI
 * language (the builder answers in it). The evidence the type matured with goes in when it fits.
 */
export function agentRequest(
  type: MaturingType,
  agentId: string,
  entry: CaseTypeStage,
): AgentRequest {
  const name = typeName(type)
  const goal = t('chat.request.goalText', { type: name })
  const s = entry.signals
  const evidence =
    s.drafts > 0 ? t('chat.request.goalEvidence', { asIs: s.draftsAsIs, drafts: s.drafts }) : ''
  const withEvidence = `${goal} ${evidence}`.trim()
  return {
    agentId,
    goal: evidence && goalLength(withEvidence) <= MAX_GOAL ? withEvidence : fitGoal(goal),
  }
}

/**
 * The proposals the builder made while she waited: the ones for her agent that the list did not
 * have before she sent the request (its answer does not name them; agent-core's list has them).
 * Newest first. Without a list from before, none (the answer's own `proposals` stay).
 */
export function newProposals(
  before: ReadonlySet<string> | null,
  after: readonly ProposalSummary[],
  agentId: string,
): ProposalSummary[] {
  if (before === null) return []
  return after.filter((p) => p.agentId === agentId && !before.has(p.proposalId))
}

/** A new idempotency key for a message (= `Idempotency-Key`). */
export function newClientMessageId(): string {
  return crypto.randomUUID()
}
