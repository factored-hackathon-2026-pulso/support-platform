import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui'
import { applyCaseSummaryToInboxes } from '@/features/cases'
import type { ApiProblem } from '@/lib/api'
import {
  acknowledgeEscalation,
  conversationKeys,
  conversationMutationKeys,
  escalateCase,
  withdrawEscalation,
} from '../api'
import { applySummary, describeEscalationFailure } from '../model'
import type { CaseDetail, Escalation, EscalationResult } from '../types'

/**
 * The answer of an escalation command (slice 9) → the detail cache (the escalation and the
 * newer summary), every cached inbox (the "Escalado" marker) and the transcript (the staff
 * banner the command wrote).
 */
export function storeEscalationResult(queryClient: QueryClient, result: EscalationResult): void {
  const caseId = result.case.id
  queryClient.setQueryData<CaseDetail>(conversationKeys.detail(caseId), (detail) =>
    detail
      ? {
          ...applySummary(detail, result.case),
          escalation: result.escalation,
          capabilities: {
            ...detail.capabilities,
            canEscalate: result.escalation.state !== 'open' && detail.capabilities.canReply,
          },
        }
      : detail,
  )
  applyCaseSummaryToInboxes(queryClient, result.case)
  void queryClient.invalidateQueries({ queryKey: conversationKeys.turns(caseId), exact: true })
}

/**
 * POST /cases/{caseId}/escalations. The dialog owns the `Idempotency-Key` (one per opening),
 * so a retry after a lost answer replays the escalation instead of `escalation_open`.
 */
export function useEscalateCase(caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<EscalationResult, ApiProblem, { motive: string; idempotencyKey: string }>({
    mutationKey: conversationMutationKeys.escalate(caseId),
    mutationFn: ({ motive, idempotencyKey }) => escalateCase(caseId, motive, idempotencyKey),
    onSuccess: (result) => storeEscalationResult(queryClient, result),
  })
}

/** "Retirar escalamiento": no confirmation; a failure says why in a toast. */
export function useWithdrawEscalation(caseId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation<EscalationResult, ApiProblem, Escalation>({
    mutationKey: conversationMutationKeys.withdrawEscalation(caseId),
    mutationFn: (escalation) => withdrawEscalation(caseId, escalation.id),
    onSuccess: (result) => storeEscalationResult(queryClient, result),
    onError: (error) => {
      toast({
        title: 'No se retiró el escalamiento',
        description: describeEscalationFailure(error, 'withdraw'),
        politeness: 'alert',
      })
      void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(caseId) })
    },
  })
}

/**
 * "Entendido": optimistic (the card goes away at once); a failure puts it back and toasts.
 */
export function useAcknowledgeEscalation(caseId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const key = conversationKeys.detail(caseId)
  return useMutation<EscalationResult, ApiProblem, Escalation, { previous: Escalation }>({
    mutationKey: conversationMutationKeys.acknowledgeEscalation(caseId),
    mutationFn: (escalation) => acknowledgeEscalation(caseId, escalation.id),
    onMutate: async (escalation) => {
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      queryClient.setQueryData<CaseDetail>(key, (detail) =>
        detail?.escalation?.id === escalation.id
          ? {
              ...detail,
              escalation: { ...escalation, acknowledgedAt: new Date().toISOString() },
            }
          : detail,
      )
      return { previous: escalation }
    },
    onSuccess: (result) =>
      queryClient.setQueryData<CaseDetail>(key, (detail) =>
        detail ? { ...detail, escalation: result.escalation } : detail,
      ),
    onError: (error, _escalation, context) => {
      if (context) {
        queryClient.setQueryData<CaseDetail>(key, (detail) =>
          detail?.escalation?.id === context.previous.id
            ? { ...detail, escalation: context.previous }
            : detail,
        )
      }
      toast({
        title: 'No se marcó como leído',
        description: describeEscalationFailure(error, 'acknowledge'),
        politeness: 'alert',
      })
    },
  })
}
