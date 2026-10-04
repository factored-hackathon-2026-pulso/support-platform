import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { customerChatKeys, customerChatMutationKeys, rateConversation } from '../api'
import {
  applyConversation,
  emptyChat,
  parseSkippedRatings,
  ratingFailureRefetches,
  serializeSkippedRatings,
  type CustomerRatingScore,
} from '../model'
import type { CustomerChatCache, CustomerConversation } from '../types'

/** sessionStorage key of the conversations the customer chose not to rate ("Ahora no"). */
export const SKIPPED_RATINGS_STORAGE_KEY = 'cc.customer.rating-skipped'

function readSkipped(): Set<string> {
  try {
    return parseSkippedRatings(globalThis.sessionStorage?.getItem(SKIPPED_RATINGS_STORAGE_KEY))
  } catch {
    // Blocked storage (privacy mode): the skip still holds for this page.
    return new Set()
  }
}

function writeSkipped(ids: ReadonlySet<string>): void {
  try {
    globalThis.sessionStorage?.setItem(SKIPPED_RATINGS_STORAGE_KEY, serializeSkippedRatings(ids))
  } catch {
    // See readSkipped.
  }
}

/**
 * "Ahora no" (slice 7): the conversations whose survey the customer skipped, kept in the
 * simulator's sessionStorage (like its token), so a reload does not ask again.
 */
export function useSkippedRatings() {
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(readSkipped)
  const skip = useCallback((caseId: string) => {
    setSkipped((current) => {
      const next = new Set(current)
      next.add(caseId)
      writeSkipped(next)
      return next
    })
  }, [])
  return { skipped, skip }
}

export interface RateInput {
  caseId: string
  score: CustomerRatingScore
  comment: string | null
  /** One `Idempotency-Key` per survey: a retry of the same answer replays. */
  idempotencyKey: string
}

/**
 * Sends the rating; the answer (the conversation with its `rating`) goes into the chat
 * cache, so the survey turns into the thanks pill. `already_rated` / `case_not_closed`
 * mean the conversation changed elsewhere: refetch it and let the survey follow.
 */
export function useRateConversation(customerId: string) {
  const queryClient = useQueryClient()
  const key = customerChatKeys.conversation(customerId)
  return useMutation<CustomerConversation, ApiProblem, RateInput>({
    mutationKey: customerChatMutationKeys.rate(customerId),
    mutationFn: ({ caseId, score, comment, idempotencyKey }) =>
      rateConversation(caseId, { score, comment }, idempotencyKey),
    onSuccess: (conversation) => {
      queryClient.setQueryData<CustomerChatCache>(key, (current) =>
        applyConversation(current ?? emptyChat(), conversation),
      )
    },
    onError: (error) => {
      if (ratingFailureRefetches(error)) {
        void queryClient.invalidateQueries({ queryKey: key, exact: true })
      }
    },
  })
}
