import { useCallback } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui'
import { applyCaseSummaryToInboxes, caseKeys, type InboxResponse } from '@/features/cases'
import type { ApiProblem } from '@/lib/api'
import { changeCasePriority, conversationKeys, conversationMutationKeys } from '../api'
import { applySummary, conflictCurrentCase, describePriorityFailure } from '../model'
import type { CaseDetail, CasePriority, CasePriorityResult, CaseSummary } from '../types'

interface PriorityChange {
  priority: CasePriority
  /** The case version the viewer saw (`expectedVersion`). */
  expectedVersion: number
  /** The level before the change: restored on a failure. */
  previous: CasePriority
}

/** Writes `priority` into every cached copy of the case still at `version`. */
function writePriority(
  queryClient: QueryClient,
  caseId: string,
  version: number,
  priority: CasePriority,
): void {
  const patch = (summary: CaseSummary) =>
    summary.id === caseId && summary.version === version ? { ...summary, priority } : summary
  queryClient.setQueryData<CaseDetail>(conversationKeys.detail(caseId), (detail) =>
    detail ? { ...detail, case: patch(detail.case) } : detail,
  )
  for (const [queryKey, inbox] of queryClient.getQueriesData<InboxResponse>({
    queryKey: caseKeys.inboxes(),
  })) {
    if (inbox?.items.some((item) => item.id === caseId)) {
      queryClient.setQueryData<InboxResponse>(queryKey, { ...inbox, items: inbox.items.map(patch) })
    }
  }
}

/** A fresher summary (the answer, or the `current` of a conflict) → detail and inboxes. */
function storeSummary(queryClient: QueryClient, summary: CaseSummary): void {
  queryClient.setQueryData<CaseDetail>(conversationKeys.detail(summary.id), (detail) =>
    detail ? applySummary(detail, summary) : detail,
  )
  applyCaseSummaryToInboxes(queryClient, summary)
}

/**
 * PUT /cases/{caseId}/priority (slice 8) with an optimistic update: the new level shows at
 * once in the ficha, the cards and Inicio; the server's case (a newer version) replaces it.
 * A `version_conflict` whose `current` still has the level the viewer saw (only a message or
 * a read moved the version) is sent once more with the fresh version; if someone else set the
 * same level it is a success. Any other failure puts the previous level back (or the case as
 * the server has it now) and says why in a toast.
 *
 * Returns `change(priority)`, which reads the version and the level from the detail cache.
 */
export function useChangePriority(caseId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation<CasePriorityResult, ApiProblem, PriorityChange>({
    mutationKey: conversationMutationKeys.priority(caseId),
    mutationFn: async ({ priority, expectedVersion, previous }) => {
      try {
        return await changeCasePriority(caseId, { priority, expectedVersion })
      } catch (error) {
        const current = conflictCurrentCase(error)
        if (current?.priority === priority) return { changed: false, case: current }
        if (current?.priority === previous) {
          return changeCasePriority(caseId, { priority, expectedVersion: current.version })
        }
        throw error
      }
    },
    onMutate: async ({ priority, expectedVersion }) => {
      await queryClient.cancelQueries({ queryKey: conversationKeys.detail(caseId), exact: true })
      writePriority(queryClient, caseId, expectedVersion, priority)
    },
    onSuccess: (result) => storeSummary(queryClient, result.case),
    onError: (error, { expectedVersion, previous }) => {
      const current = conflictCurrentCase(error)
      if (current) storeSummary(queryClient, current)
      else writePriority(queryClient, caseId, expectedVersion, previous)
      toast({ ...describePriorityFailure(error), politeness: 'alert' })
    },
  })
  const { mutate } = mutation

  const change = useCallback(
    (priority: CasePriority) => {
      const summary = queryClient.getQueryData<CaseDetail>(conversationKeys.detail(caseId))?.case
      if (!summary || summary.priority === priority) return
      mutate({ priority, expectedVersion: summary.version, previous: summary.priority })
    },
    [caseId, mutate, queryClient],
  )
  return { change, isPending: mutation.isPending }
}
