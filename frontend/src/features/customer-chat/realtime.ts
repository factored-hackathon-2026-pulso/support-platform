/**
 * Customer simulator realtime (slice-2-case-lifecycle.md §7, §9.6): envelopes on
 * `customer:<id>` → the chat cache. Registered in the simulator's **own**
 * registry (its socket authenticates with the customer token), never in
 * `app/realtime-handlers.ts`.
 *
 * Idempotent: turns merge by id. A conversation of another, newer case (a new
 * one opened after the last closed) keeps the closed one as a past block and
 * refetches; a turn of another case refetches the conversation.
 */
import type { QueryClient } from '@tanstack/react-query'
import {
  createEnvelopeHandlerRegistry,
  envelopeCaseId,
  envelopePayload,
  type EnvelopeHandlerRegistry,
  type RealtimeEnvelope,
  type RealtimeRegistration,
} from '@/lib/realtime'
import { customerChatKeys } from './api'
import { applyConversation, isNewerConversation, isSameCase, mergeCustomerTurns } from './model'
import type { CustomerChatCache, CustomerConversation, CustomerTurn } from './types'

function readData(envelope: RealtimeEnvelope) {
  const payload = envelopePayload(envelope)
  return payload ? { payload, caseId: envelopeCaseId(envelope) } : null
}

/** Every cached chat of this tab (there is one signed-in customer at a time). */
const chatQueries = {
  queryKey: customerChatKeys.all,
  predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[2] === 'conversation',
}

function forEachChat(
  queryClient: QueryClient,
  apply: (cache: CustomerChatCache, key: readonly unknown[]) => void,
): void {
  for (const [key, cache] of queryClient.getQueriesData<CustomerChatCache>(chatQueries)) {
    if (cache) apply(cache, key)
  }
}

function applyTurn(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const data = readData(envelope)
  if (!data || typeof data.payload.id !== 'string' || typeof data.payload.sequence !== 'number')
    return
  const turn = data.payload as unknown as CustomerTurn
  forEachChat(queryClient, (cache, key) => {
    if (isSameCase(cache, data.caseId)) {
      queryClient.setQueryData<CustomerChatCache>(key, (current) =>
        current ? mergeCustomerTurns(current, [turn]) : current,
      )
    } else {
      void queryClient.invalidateQueries({ queryKey: key, exact: true })
    }
  })
}

function applyConversationUpdate(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const data = readData(envelope)
  if (!data || typeof data.payload.caseId !== 'string') return
  const conversation = data.payload as unknown as CustomerConversation
  forEachChat(queryClient, (cache, key) => {
    if (isSameCase(cache, conversation.caseId)) {
      queryClient.setQueryData<CustomerChatCache>(key, (current) =>
        current ? applyConversation(current, conversation) : current,
      )
      return
    }
    // A late update of an older case never switches the chat back.
    if (!isNewerConversation(conversation, cache.conversation)) return
    queryClient.setQueryData<CustomerChatCache>(key, (current) =>
      current ? applyConversation(current, conversation) : current,
    )
    void queryClient.invalidateQueries({ queryKey: key, exact: true })
    const customerId = key[1]
    if (typeof customerId === 'string') {
      void queryClient.invalidateQueries({
        queryKey: customerChatKeys.pastConversations(customerId),
      })
    }
  })
}

export const registerCustomerChatRealtime: RealtimeRegistration = (registry) => {
  registry.register('turn.created', applyTurn)
  registry.register('conversation.updated', applyConversationUpdate)
}

/** The simulator's registry (one per mounted simulator). */
export function createCustomerChatHandlers(): EnvelopeHandlerRegistry {
  const registry = createEnvelopeHandlerRegistry()
  registerCustomerChatRealtime(registry)
  return registry
}
