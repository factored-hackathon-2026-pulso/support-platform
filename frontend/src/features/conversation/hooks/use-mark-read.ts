import { useEffect, useSyncExternalStore } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { applyCaseSummaryToInboxes } from '@/features/cases'
import { conversationKeys, conversationMutationKeys, markCaseRead } from '../api'
import { applySummary, readTarget } from '../model'
import type { CaseDetail, CaseSummary } from '../types'

/** Debounce of the read cursor (contract §7.2: "debounced ~1 s"). */
export const MARK_READ_DELAY_MS = 1000

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

function isDocumentVisible(): boolean {
  return document.visibilityState !== 'hidden'
}

/**
 * Moves the assignee's read cursor to the last turn when the case is new or has
 * unread customer messages, while the tab is visible. The server moves an
 * `assigned` case to `in_progress` (Nuevos → Por responder).
 *
 * `enabled: false` never marks (the supervisor view, even on the viewer's own
 * case). A 403 is silent: supervision reassigned the case meanwhile, and the
 * `case.updated` that follows turns the pane read-only (slice 3 §3.9).
 */
export function useMarkRead(summary: CaseSummary | undefined, meId: string, enabled = true): void {
  const queryClient = useQueryClient()
  const visible = useSyncExternalStore(subscribeVisibility, isDocumentVisible, () => true)
  const caseId = summary?.id ?? ''
  const { mutate } = useMutation({
    mutationKey: conversationMutationKeys.read(caseId),
    mutationFn: ({ id, upTo }: { id: string; upTo: number }) => markCaseRead(id, upTo),
    onSuccess: (fresh) => {
      queryClient.setQueryData<CaseDetail>(conversationKeys.detail(fresh.id), (detail) =>
        detail ? applySummary(detail, fresh) : detail,
      )
      applyCaseSummaryToInboxes(queryClient, fresh)
    },
    // Silent on purpose: a 403 (not the assignee any more) is expected after a
    // reassignment and the pane updates itself; any other failure is retried on
    // the next change of the read target. Nothing to show the analyst.
    onError: () => undefined,
  })

  const target = enabled && summary ? readTarget(summary, meId) : null
  useEffect(() => {
    if (target === null || !visible || !caseId) return
    const timer = setTimeout(() => mutate({ id: caseId, upTo: target }), MARK_READ_DELAY_MS)
    return () => clearTimeout(timer)
  }, [caseId, target, visible, mutate])
}
