import { useEffect, useRef } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { conversationKeys, fetchTurns } from '../api'
import {
  CATCH_UP_PAGE_SIZE,
  emptyTranscript,
  mergeOlderPage,
  mergeTurns,
  transcriptFromPage,
} from '../model'
import type { TranscriptCache, Turn } from '../types'

/**
 * Query function of the turns cache. The first load takes the latest page; every
 * later run (remount, reconnect, gap) only asks for what is missing
 * (`?afterSequence=contiguousSequence`, paging until the end: the first hole,
 * not the highest turn held, so a turn missed while the socket was down is
 * always fetched), and older pages the analyst loaded and messages still
 * pending are kept. The result is merged into
 * the cache as it is when the request ends, never into a stale snapshot.
 */
export async function loadTranscript(
  queryClient: QueryClient,
  caseId: string,
  signal?: AbortSignal,
): Promise<TranscriptCache> {
  const key = conversationKeys.turns(caseId)
  const before = queryClient.getQueryData<TranscriptCache>(key)
  if (!before || before.turns.length === 0) {
    const page = await fetchTurns(caseId, {}, signal)
    return transcriptFromPage(page, queryClient.getQueryData<TranscriptCache>(key))
  }
  const fetched: Turn[] = []
  let after = before.contiguousSequence
  for (;;) {
    const page = await fetchTurns(
      caseId,
      { afterSequence: after, limit: CATCH_UP_PAGE_SIZE },
      signal,
    )
    fetched.push(...page.items)
    const last = page.items[page.items.length - 1]
    if (!last || page.items.length < CATCH_UP_PAGE_SIZE) break
    after = last.sequence
  }
  return mergeTurns(queryClient.getQueryData<TranscriptCache>(key) ?? before, fetched)
}

/**
 * Turns of one case, kept live by `turn.created` (realtime.ts). Always stale, so
 * re-opening a case catches up on what arrived while it was not subscribed.
 * `expectedLastSequence` (from the case summary) catches a turn whose envelope
 * never reached this tab: when the case says there is more than the gap-free
 * part of the cache, ask for it.
 */
export function useCaseTurns(
  caseId: string,
  expectedLastSequence?: number,
): UseQueryResult<TranscriptCache, ApiProblem> {
  const queryClient = useQueryClient()
  const query = useQuery<TranscriptCache, ApiProblem>({
    queryKey: conversationKeys.turns(caseId),
    queryFn: ({ signal }) => loadTranscript(queryClient, caseId, signal),
    staleTime: 0,
  })

  // Latest fetch state, read by the catch-up effect without re-running it on every toggle.
  const latest = useRef(query)
  useEffect(() => {
    latest.current = query
  })
  const held = query.data?.contiguousSequence
  useEffect(() => {
    if (expectedLastSequence === undefined || held === undefined) return
    if (expectedLastSequence > held && !latest.current.isFetching) void latest.current.refetch()
  }, [expectedLastSequence, held])

  return query
}

/** "Cargar mensajes anteriores": fetches the page before `olderCursor` and merges it. */
export function useLoadOlderTurns(caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiProblem>({
    mutationKey: [...conversationKeys.turns(caseId), 'older'],
    mutationFn: async () => {
      const key = conversationKeys.turns(caseId)
      const cursor = queryClient.getQueryData<TranscriptCache>(key)?.olderCursor
      if (!cursor) return
      const page = await fetchTurns(caseId, { cursor })
      queryClient.setQueryData<TranscriptCache>(key, (current) =>
        mergeOlderPage(current ?? emptyTranscript(), page),
      )
    },
  })
}
