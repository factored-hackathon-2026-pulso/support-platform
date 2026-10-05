import { useCallback } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui'
import { applyCaseSummaryToInboxes, caseKeys, type InboxResponse } from '@/features/cases'
import type { ApiProblem } from '@/lib/api'
import { changeCaseType, conversationKeys, conversationMutationKeys } from '../api'
import { applySummary, conflictCurrentCase, describeCaseTypeFailure } from '../model'
import type { CaseDetail, CaseSummary, CaseType, CaseTypeResult } from '../types'

interface CaseTypeChange {
  caseType: CaseType
  /** The case version the viewer saw (`expectedVersion`). */
  expectedVersion: number
  /** The type before the change: restored on a failure. */
  previous: CaseType
}

/** Writes `caseType` into every cached copy of the case still at `version`. */
function writeCaseType(
  queryClient: QueryClient,
  caseId: string,
  version: number,
  caseType: CaseType,
): void {
  const patch = (summary: CaseSummary) =>
    summary.id === caseId && summary.version === version ? { ...summary, caseType } : summary
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
 * PUT /cases/{caseId}/type (slice 18), exactly like `useChangePriority`: optimistic, the
 * server's case replaces it; a `version_conflict` whose `current` still has the type the
 * viewer saw is sent once more with the fresh version, one where someone set the same type is a
 * success; any other failure puts the previous type back (or the case as the server has it now)
 * and says why in a toast.
 *
 * Returns `change(caseType)`, which reads the version and the type from the detail cache.
 */
export function useChangeCaseType(caseId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation<CaseTypeResult, ApiProblem, CaseTypeChange>({
    mutationKey: conversationMutationKeys.caseType(caseId),
    mutationFn: async ({ caseType, expectedVersion, previous }) => {
      try {
        return await changeCaseType(caseId, { caseType, expectedVersion })
      } catch (error) {
        const current = conflictCurrentCase(error)
        if (current?.caseType === caseType) return { changed: false, case: current }
        if (current?.caseType === previous) {
          return changeCaseType(caseId, { caseType, expectedVersion: current.version })
        }
        throw error
      }
    },
    onMutate: async ({ caseType, expectedVersion }) => {
      await queryClient.cancelQueries({ queryKey: conversationKeys.detail(caseId), exact: true })
      writeCaseType(queryClient, caseId, expectedVersion, caseType)
    },
    onSuccess: (result) => storeSummary(queryClient, result.case),
    onError: (error, { expectedVersion, previous }) => {
      const current = conflictCurrentCase(error)
      if (current) storeSummary(queryClient, current)
      else writeCaseType(queryClient, caseId, expectedVersion, previous)
      toast({ ...describeCaseTypeFailure(error), politeness: 'alert' })
    },
  })
  const { mutate } = mutation

  const change = useCallback(
    (caseType: CaseType) => {
      const summary = queryClient.getQueryData<CaseDetail>(conversationKeys.detail(caseId))?.case
      if (!summary || summary.caseType === caseType) return
      mutate({ caseType, expectedVersion: summary.version, previous: summary.caseType })
    },
    [caseId, mutate, queryClient],
  )
  return { change, isPending: mutation.isPending }
}
