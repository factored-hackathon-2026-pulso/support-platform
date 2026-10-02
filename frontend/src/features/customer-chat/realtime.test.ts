import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvelopeHandlerRegistry } from '@/lib/realtime'
import {
  envelope,
  makeCustomerConversation,
  makeCustomerTurn,
  SIM_CASE_ID,
  SIM_CUSTOMER_ID,
} from '@/test/conversation-fixtures'
import { customerChatKeys } from './api'
import { emptyChat, mergeCustomerTurns } from './model'
import { createCustomerChatHandlers } from './realtime'
import type { CustomerChatCache } from './types'

let queryClient: QueryClient
let registry: EnvelopeHandlerRegistry
const key = customerChatKeys.conversation(SIM_CUSTOMER_ID)
const chat = () => queryClient.getQueryData<CustomerChatCache>(key)

beforeEach(() => {
  queryClient = new QueryClient()
  registry = createCustomerChatHandlers()
  queryClient.setQueryData<CustomerChatCache>(
    key,
    mergeCustomerTurns({ ...emptyChat(), conversation: makeCustomerConversation() }, [
      makeCustomerTurn({ sequence: 1 }),
    ]),
  )
})

describe('customer turn.created', () => {
  it('appends turns of the current case, once', () => {
    const event = envelope(
      'turn.created',
      makeCustomerTurn({ sequence: 4, authorRole: 'analyst', authorName: 'Daniela', text: 'Olá!' }),
      SIM_CASE_ID,
    )
    registry.dispatch(event, queryClient)
    registry.dispatch(event, queryClient)
    expect(chat()?.turns.map((t) => t.sequence)).toEqual([1, 4])
  })

  it('refetches when the turn belongs to another case (a new one opened)', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    registry.dispatch(
      envelope('turn.created', makeCustomerTurn({ sequence: 1 }), 'CASE-NEW'),
      queryClient,
    )
    expect(chat()?.turns).toHaveLength(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key, exact: true })
  })
})

describe('conversation.updated', () => {
  it('updates who attends the current case', () => {
    registry.dispatch(
      envelope(
        'conversation.updated',
        makeCustomerConversation({ status: 'with_agent', agentName: 'Daniela' }),
        SIM_CASE_ID,
      ),
      queryClient,
    )
    expect(chat()?.conversation).toMatchObject({ status: 'with_agent', agentName: 'Daniela' })
    expect(chat()?.turns).toHaveLength(1)
  })

  it('refetches for another case and ignores malformed payloads', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const before = chat()
    registry.dispatch(envelope('conversation.updated', { status: 'closed' }), queryClient)
    expect(chat()).toBe(before)
    registry.dispatch(
      envelope(
        'conversation.updated',
        makeCustomerConversation({ caseId: 'CASE-NEW' }),
        'CASE-NEW',
      ),
      queryClient,
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key, exact: true })
  })

  it('never handles staff-only event types', () => {
    expect(registry.dispatch(envelope('case.updated', {}), queryClient)).toBe(0)
    expect(registry.dispatch(envelope('inbox.counts', {}), queryClient)).toBe(0)
  })
})
