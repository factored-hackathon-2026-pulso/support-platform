import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import {
  commandCustomerCall,
  customerChatKeys,
  customerChatMutationKeys,
  fetchCustomerCall,
  postCustomerCallLine,
  sendCustomerEmail,
  startCustomerCall,
  type CustomerCallCommand,
} from '../api'
import { emailAsTurn, isNewerCustomerCall } from '../channels'
import { applyConversation, emptyChat, mergeCustomerTurns } from '../model'
import type {
  CustomerCall,
  CustomerCallState,
  CustomerChatCache,
  CustomerConversation,
  Language,
} from '../types'

/** A call that changed → the call cache (only a newer state replaces it). */
export function storeCustomerCall(
  queryClient: QueryClient,
  customerId: string,
  call: CustomerCall,
): void {
  queryClient.setQueryData<CustomerCallState>(customerChatKeys.call(customerId), (current) =>
    !current || isNewerCustomerCall(call, current.call) ? { call } : current,
  )
}

/** The conversation a call or an email joined (or opened) → the chat cache. */
function storeConversation(
  queryClient: QueryClient,
  customerId: string,
  conversation: CustomerConversation,
  caseCreated: boolean,
): void {
  const key = customerChatKeys.conversation(customerId)
  queryClient.setQueryData<CustomerChatCache>(key, (current) =>
    applyConversation(current ?? emptyChat(), conversation),
  )
  if (caseCreated) {
    // A new case: its "we got it" notice, and the closed one joins the past list.
    void queryClient.invalidateQueries({ queryKey: key, exact: true })
    void queryClient.invalidateQueries({ queryKey: customerChatKeys.pastConversations(customerId) })
  }
}

/** GET /customer/call, kept live by `call.updated` (realtime.ts). */
export function useCustomerCall(customerId: string) {
  return useQuery<CustomerCallState, ApiProblem, CustomerCall | null>({
    queryKey: customerChatKeys.call(customerId),
    queryFn: ({ signal }) => fetchCustomerCall(signal),
    select: (state) => state.call,
    staleTime: 0,
  })
}

/** "Llamar": one `Idempotency-Key` per press (a retry of the same press replays it). */
export function useStartCustomerCall(customerId: string) {
  const queryClient = useQueryClient()
  return useMutation<CustomerCall, ApiProblem, { key: string }>({
    mutationKey: customerChatMutationKeys.call(customerId),
    mutationFn: async ({ key }) => {
      const result = await startCustomerCall(key)
      storeCustomerCall(queryClient, customerId, result.call)
      storeConversation(queryClient, customerId, result.conversation, result.caseCreated)
      return result.call
    },
    onError: (error) => {
      // Someone already called on this case: show that call.
      if (error.code === 'call_in_progress') {
        void queryClient.invalidateQueries({ queryKey: customerChatKeys.call(customerId) })
      }
    },
  })
}

/** "Contestar", "Rechazar" (a call of the bank) and "Colgar". */
export function useCustomerCallCommand(customerId: string) {
  const queryClient = useQueryClient()
  return useMutation<CustomerCall, ApiProblem, { callId: string; command: CustomerCallCommand }>({
    mutationKey: customerChatMutationKeys.call(customerId),
    scope: { id: `customer-call:${customerId}` },
    mutationFn: async ({ callId, command }) => {
      const result = await commandCustomerCall(callId, command)
      storeCustomerCall(queryClient, customerId, result.call)
      storeConversation(queryClient, customerId, result.conversation, result.caseCreated)
      return result.call
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: customerChatKeys.call(customerId) })
    },
  })
}

/** What the customer says on the line: the turn joins the conversation (lines both ways). */
export function useCustomerCallLine(customerId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiProblem, { callId: string; text: string; clientMessageId: string }>({
    mutationKey: customerChatMutationKeys.send(customerId),
    scope: { id: `customer-send:${customerId}` },
    mutationFn: async ({ callId, text, clientMessageId }) => {
      const { turn, call } = await postCustomerCallLine(callId, { text, clientMessageId })
      storeCustomerCall(queryClient, customerId, call)
      queryClient.setQueryData<CustomerChatCache>(
        customerChatKeys.conversation(customerId),
        (current) => mergeCustomerTurns(current ?? emptyChat(), [turn]),
      )
    },
  })
}

/** "Enviar" an email: a new thread (with its subject) or a reply in the current one. */
export function useSendCustomerEmail(customerId: string, language: Language) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiProblem, { subject: string; body: string; clientMessageId: string }>({
    mutationKey: customerChatMutationKeys.email(customerId),
    scope: { id: `customer-send:${customerId}` },
    mutationFn: async (input) => {
      const { email, conversation, caseCreated } = await sendCustomerEmail(input)
      const key = customerChatKeys.conversation(customerId)
      queryClient.setQueryData<CustomerChatCache>(key, (current) =>
        mergeCustomerTurns(applyConversation(current ?? emptyChat(), conversation), [
          emailAsTurn(email, conversation.language ?? language),
        ]),
      )
      if (caseCreated) {
        void queryClient.invalidateQueries({ queryKey: key, exact: true })
        void queryClient.invalidateQueries({
          queryKey: customerChatKeys.pastConversations(customerId),
        })
      }
    },
  })
}
