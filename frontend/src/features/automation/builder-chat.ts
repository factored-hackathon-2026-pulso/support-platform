/**
 * Pure rules of the chat with the builder agent (`constructor-chat`, slice 16; screens in slice
 * 22): the thread with the message in flight, the failures in words, and the first message of
 * "Proponer un agente". No React, no I/O: builder-chat.test.ts.
 */
import { isApiProblem } from '@/lib/api'
import { i18n } from '@/lib/i18n'
import type { BuilderMessage, BuilderThread, CaseTypeStage, MaturingType } from './types'

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
 * Case type names as the builder agent reads them. `constructor-chat` speaks Spanish only
 * (agent-core: `supported_locales: [es]`, and the platform sends `lang: es`), so its first message
 * is Spanish whatever the UI language: these are the dataset's subcategory names (ADR 0006 §2),
 * not UI copy.
 */
const TYPE_FOR_BUILDER: Record<MaturingType, string> = {
  unrecognized_charge: 'Cargo no reconocido',
  undue_charge: 'Cobro indebido',
  app_issue: 'Problema con app',
  branch_service: 'Atención en sucursal', // i18n-ignore: agent input, Spanish only (above)
  service_quality: 'Calidad de servicio',
  virtual_card: 'Tarjeta virtual',
}

/**
 * The first message of "Proponer un agente" (prefilled, she can edit it): the agent to create
 * (the `agente` slot of `constructor-chat`'s flow) and what it should do (`objetivo`), with the
 * evidence the type matured with. In Spanish, for the builder agent (see above).
 */
export function newAgentRequest(type: MaturingType, agentId: string, entry: CaseTypeStage): string {
  const name = TYPE_FOR_BUILDER[type]
  const s = entry.signals
  const evidence =
    s.drafts > 0
      ? // i18n-ignore-next-line: agent input, Spanish only (see TYPE_FOR_BUILDER)
        ` El equipo envía ${s.draftsAsIs} de los últimos ${s.drafts} borradores del copiloto tal cual o con cambios menores.`
      : ''
  return (
    `Agente: ${agentId}. Objetivo: un agente nuevo que atienda los chats de los casos de tipo ` +
    `"${name}" como lo hace el equipo y pase a una persona lo que no pueda resolver.${evidence}`
  )
}

/** A new idempotency key for a message (= `Idempotency-Key`). */
export function newClientMessageId(): string {
  return crypto.randomUUID()
}
