import { useCallback } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { applyCaseSummaryToInboxes } from '@/features/cases'
import { copilotKeys } from '@/features/copilot/core'
import { conversationKeys, conversationMutationKeys, postAnalystTurn } from '../api'
import {
  addPending,
  applySummary,
  describeSendFailure,
  emptyTranscript,
  hasMissingTurns,
  mergeTurns,
  updatePending,
} from '../model'
import type { CaseDetail, CaseSummary, TranscriptCache, Turn } from '../types'

export function newClientMessageId(): string {
  return crypto.randomUUID()
}

/** One queue of sends per case (see `useSendMessage`). */
export function sendScope(caseId: string): string {
  return `send:${caseId}`
}

interface SendInput {
  text: string
  clientMessageId: string
  /** Slice 20: the copilot draft the reply came from (the backend derives used / edited). */
  copilotSuggestionId?: string | null
}

export interface SendOptions {
  copilotSuggestionId?: string | null
}

/**
 * Posts one message and reconciles the cache, whatever the component does in
 * the meantime (switching case does not lose the result): the confirmed turn
 * replaces the pending one (same `clientMessageId`, also matched against the
 * realtime echo), or the pending one turns "failed".
 */
/**
 * A turn the analyst wrote (a chat reply, a call line, a note, an email) and the case
 * summary the server answered with → the transcript, the detail and the inboxes.
 */
export function storeTurnResult(
  queryClient: QueryClient,
  caseId: string,
  { turn, case: summary }: { turn: Turn; case: CaseSummary },
): void {
  const turnsKey = conversationKeys.turns(caseId)
  const merged = queryClient.setQueryData<TranscriptCache>(turnsKey, (current) =>
    mergeTurns(current ?? emptyTranscript(), [turn]),
  )
  // Our turn landed past a turn this tab never got (socket down meanwhile): catch up.
  if (merged && hasMissingTurns(merged)) {
    void queryClient.invalidateQueries({ queryKey: turnsKey, exact: true })
  }
  queryClient.setQueryData<CaseDetail>(conversationKeys.detail(caseId), (detail) =>
    detail ? applySummary(detail, summary) : detail,
  )
  // Same summary the server pushes as `case.updated`: patch now, refetch only on a move.
  applyCaseSummaryToInboxes(queryClient, summary)
}

async function sendAndReconcile(queryClient: QueryClient, caseId: string, input: SendInput) {
  const turnsKey = conversationKeys.turns(caseId)
  try {
    const { copilotSuggestionId, ...rest } = input
    const body = copilotSuggestionId ? { ...rest, copilotSuggestionId } : rest
    storeTurnResult(queryClient, caseId, await postAnalystTurn(caseId, body))
    // The draft was decided (used or edited): it leaves the newest suggestion.
    if (copilotSuggestionId) {
      void queryClient.invalidateQueries({ queryKey: copilotKeys.latest(caseId), exact: true })
    }
  } catch (error) {
    const failure = describeSendFailure(error)
    queryClient.setQueryData<TranscriptCache>(turnsKey, (current) =>
      current
        ? updatePending(current, input.clientMessageId, {
            status: 'failed',
            error: failure.message,
            retryable: failure.retryable,
          })
        : current,
    )
    throw error
  }
}

/**
 * Optimistic send: the message shows at once as "Enviando…", then sent or
 * "No se envió · Reintentar". A retry re-posts the **same** `clientMessageId`
 * (`Idempotency-Key`), so a message that did reach the server is never duplicated.
 *
 * Sends of one case share a mutation `scope`, so TanStack runs them one after
 * another: the server numbers turns in commit order, and parallel POSTs would
 * store quick messages in whatever order they happened to commit.
 */
export function useSendMessage(caseId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationKey: conversationMutationKeys.send(caseId),
    scope: { id: sendScope(caseId) },
    mutationFn: (input: SendInput) => sendAndReconcile(queryClient, caseId, input),
  })
  const { mutate } = mutation

  const send = useCallback(
    (text: string, options: SendOptions = {}) => {
      const copilotSuggestionId = options.copilotSuggestionId ?? null
      const clientMessageId = newClientMessageId()
      queryClient.setQueryData<TranscriptCache>(conversationKeys.turns(caseId), (current) =>
        addPending(current ?? emptyTranscript(), {
          clientMessageId,
          text,
          createdAt: new Date().toISOString(),
          status: 'sending',
          error: null,
          retryable: false,
          ...(copilotSuggestionId ? { copilotSuggestionId } : {}),
        }),
      )
      mutate({ text, clientMessageId, copilotSuggestionId })
    },
    [caseId, mutate, queryClient],
  )

  const retry = useCallback(
    (clientMessageId: string) => {
      const key = conversationKeys.turns(caseId)
      const message = queryClient
        .getQueryData<TranscriptCache>(key)
        ?.pending.find((m) => m.clientMessageId === clientMessageId)
      if (!message) return
      queryClient.setQueryData<TranscriptCache>(key, (current) =>
        current
          ? updatePending(current, clientMessageId, { status: 'sending', error: null })
          : current,
      )
      mutate({
        text: message.text,
        clientMessageId,
        copilotSuggestionId: message.copilotSuggestionId ?? null,
      })
    },
    [caseId, mutate, queryClient],
  )

  return { send, retry }
}
