import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { topics, useRealtimeStatus, useRealtimeSubscription } from '@/lib/realtime'
import {
  customerChatKeys,
  customerChatMutationKeys,
  fetchCustomerConversation,
  fetchPastConversation,
  listDemoCustomers,
  listPastConversations,
  postCustomerTurn,
} from '../api'
import {
  addPendingCustomer,
  applyConversation,
  chatFromResponse,
  emptyChat,
  mergeCustomerTurns,
  setPendingStatus,
} from '../model'
import type {
  CustomerChatCache,
  CustomerConversationDetail,
  CustomerConversationList,
  DemoCustomerList,
} from '../types'

export function useDemoCustomers(): UseQueryResult<DemoCustomerList, ApiProblem> {
  return useQuery<DemoCustomerList, ApiProblem>({
    queryKey: customerChatKeys.demoCustomers(),
    queryFn: ({ signal }) => listDemoCustomers(signal),
  })
}

/** The customer's conversation, merged into the cache so pending sends survive refetches. */
export function useCustomerConversation(
  customerId: string,
): UseQueryResult<CustomerChatCache, ApiProblem> {
  const queryClient = useQueryClient()
  const key = customerChatKeys.conversation(customerId)
  return useQuery<CustomerChatCache, ApiProblem>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const response = await fetchCustomerConversation(signal)
      return chatFromResponse(response, queryClient.getQueryData<CustomerChatCache>(key))
    },
    staleTime: 0,
  })
}

/** GET /customer/conversations, loaded when "Ver conversaciones anteriores" is pressed. */
export function usePastConversations(
  customerId: string,
  enabled: boolean,
): UseQueryResult<CustomerConversationList, ApiProblem> {
  return useQuery<CustomerConversationList, ApiProblem>({
    queryKey: customerChatKeys.pastConversations(customerId),
    queryFn: ({ signal }) => listPastConversations(signal),
    enabled,
  })
}

/** GET /customer/conversations/{caseId}, loaded when a past block is expanded. */
export function usePastConversation(
  customerId: string,
  caseId: string,
  enabled: boolean,
): UseQueryResult<CustomerConversationDetail, ApiProblem> {
  return useQuery<CustomerConversationDetail, ApiProblem>({
    queryKey: customerChatKeys.pastConversation(customerId, caseId),
    queryFn: ({ signal }) => fetchPastConversation(caseId, signal),
    enabled,
    // A closed conversation does not change.
    staleTime: Infinity,
  })
}

/**
 * Live chat: subscribe to `customer:<id>` while mounted and refetch the
 * conversation when the socket comes back (no gap detection on the customer side:
 * visible sequences skip staff-only turns).
 */
export function useCustomerChatLive(customerId: string): void {
  useRealtimeSubscription(topics.customer(customerId))
  const status = useRealtimeStatus()
  const queryClient = useQueryClient()
  const previous = useRef(status)
  useEffect(() => {
    if (previous.current === 'reconnecting' && status === 'open') {
      void queryClient.invalidateQueries({ queryKey: customerChatKeys.conversation(customerId) })
    }
    previous.current = status
  }, [status, customerId, queryClient])
}

/**
 * Optimistic send as the customer; a retry re-posts the same `clientMessageId`
 * (`Idempotency-Key`), so the analyst never sees the message twice. Sends share
 * a mutation `scope`, so they reach the server one after another, in the order
 * the customer typed them ("hola?", "hola??", "contesten!!").
 */
export function useSendCustomerMessage(customerId: string) {
  const queryClient = useQueryClient()
  const key = customerChatKeys.conversation(customerId)
  const { mutate } = useMutation({
    mutationKey: customerChatMutationKeys.send(customerId),
    scope: { id: `customer-send:${customerId}` },
    mutationFn: async (input: { text: string; clientMessageId: string }) => {
      try {
        const { turn, conversation, caseCreated } = await postCustomerTurn(input)
        queryClient.setQueryData<CustomerChatCache>(key, (current) =>
          mergeCustomerTurns(applyConversation(current ?? emptyChat(), conversation), [turn]),
        )
        // Writing after a close opened a new case: the closed one joins the past list.
        if (caseCreated) {
          void queryClient.invalidateQueries({
            queryKey: customerChatKeys.pastConversations(customerId),
          })
        }
      } catch (error) {
        queryClient.setQueryData<CustomerChatCache>(key, (current) =>
          current ? setPendingStatus(current, input.clientMessageId, 'failed') : current,
        )
        throw error
      }
    },
  })

  const send = useCallback(
    (text: string) => {
      const clientMessageId = crypto.randomUUID()
      const chatKey = customerChatKeys.conversation(customerId)
      queryClient.setQueryData<CustomerChatCache>(chatKey, (current) =>
        addPendingCustomer(current ?? emptyChat(), {
          clientMessageId,
          text,
          createdAt: new Date().toISOString(),
          status: 'sending',
        }),
      )
      mutate({ text, clientMessageId })
    },
    [customerId, mutate, queryClient],
  )

  const retry = useCallback(
    (clientMessageId: string) => {
      const chatKey = customerChatKeys.conversation(customerId)
      const message = queryClient
        .getQueryData<CustomerChatCache>(chatKey)
        ?.pending.find((m) => m.clientMessageId === clientMessageId)
      if (!message) return
      queryClient.setQueryData<CustomerChatCache>(chatKey, (current) =>
        current ? setPendingStatus(current, clientMessageId, 'sending') : current,
      )
      mutate({ text: message.text, clientMessageId })
    },
    [customerId, mutate, queryClient],
  )

  return { send, retry }
}
