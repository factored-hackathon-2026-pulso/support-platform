import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createEnvelopeHandlerRegistry, type RealtimeEnvelope } from '@/lib/realtime'
import {
  NOW,
  available,
  makeCaseSummary,
  makeCounts,
  makeInbox,
  paused,
} from '@/test/case-fixtures'
import { availabilityKeys, caseKeys } from './api'
import { applyCaseSummaryToInboxes, registerCasesRealtime } from './realtime'
import type { InboxResponse } from './types'

function setup() {
  const registry = createEnvelopeHandlerRegistry()
  registerCasesRealtime(registry)
  const queryClient = new QueryClient()
  const todos = caseKeys.inbox({ status: null, q: '' })
  const toReply = caseKeys.inbox({ status: 'to_reply', q: '' })
  queryClient.setQueryData(todos, makeInbox())
  queryClient.setQueryData(toReply, makeInbox())
  return { registry, queryClient, todos, toReply }
}

const MARCELA = makeCaseSummary().id

function cardOf(queryClient: QueryClient, key: readonly unknown[], id = MARCELA) {
  return queryClient.getQueryData<InboxResponse>(key)?.items.find((item) => item.id === id)
}

function envelope(type: string, payload: unknown, id = 'EVT-1'): RealtimeEnvelope {
  return {
    type,
    id,
    occurredAt: NOW.toISOString(),
    data: { entity: 'case', entityId: 'CASE-1', caseId: null, actor: null, payload },
  }
}

describe('registerCasesRealtime', () => {
  it('handles the inbox event types of the contract', () => {
    const { registry, queryClient } = setup()
    for (const type of ['case.updated', 'case.assigned', 'inbox.counts', 'availability.updated']) {
      expect(registry.dispatch(envelope(type, {}), queryClient)).toBe(1)
    }
  })

  it('case.updated patches a newer card and refetches when its status bucket changes', () => {
    const { registry, queryClient, todos, toReply } = setup()
    const updated = makeCaseSummary({ version: 4, inboxStatus: 'waiting', preview: 'Hola' })
    registry.dispatch(envelope('case.updated', updated), queryClient)
    expect(cardOf(queryClient, todos)).toEqual(updated)
    expect(queryClient.getQueryState(todos)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(toReply)?.isInvalidated).toBe(true)
  })

  it('case.updated that keeps the card in place patches it without any refetch', () => {
    const { registry, queryClient, todos, toReply } = setup()
    const updated = makeCaseSummary({ version: 4, preview: '¿Hola?', unreadCount: 2 })
    registry.dispatch(envelope('case.updated', updated), queryClient)
    expect(cardOf(queryClient, toReply)).toEqual(updated)
    expect(queryClient.getQueryState(todos)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(toReply)?.isInvalidated).toBe(false)
  })

  it('applyCaseSummaryToInboxes makes the later envelope of the same version a no-op', () => {
    const { registry, queryClient, todos } = setup()
    const read = makeCaseSummary({ version: 4, unreadCount: 0, lastSequence: 7 })
    applyCaseSummaryToInboxes(queryClient, read)
    const after = queryClient.getQueryData<InboxResponse>(todos)
    expect(cardOf(queryClient, todos)).toEqual(read)
    registry.dispatch(envelope('case.updated', read), queryClient)
    expect(queryClient.getQueryData(todos)).toBe(after)
    expect(queryClient.getQueryState(todos)?.isInvalidated).toBe(false)
  })

  it('case.updated ignores an older or repeated version', () => {
    const { registry, queryClient, todos } = setup()
    const stale = makeCaseSummary({ version: 3, preview: 'viejo' })
    registry.dispatch(envelope('case.updated', stale), queryClient)
    expect(cardOf(queryClient, todos)?.preview).toBe(makeCaseSummary().preview)
  })

  it('case.assigned refetches only the inboxes the new case belongs to', () => {
    const { registry, queryClient, todos, toReply } = setup()
    const nuevos = caseKeys.inbox({ status: 'new', q: '' })
    queryClient.setQueryData(nuevos, makeInbox([]))
    const fresh = makeCaseSummary({ id: 'CASE-NEW', status: 'assigned', inboxStatus: 'new' })
    registry.dispatch(envelope('case.assigned', fresh), queryClient)
    expect(queryClient.getQueryState(todos)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(nuevos)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(toReply)?.isInvalidated).toBe(false)
  })

  it('a close moves the card out of the open inboxes and into Cerrados', () => {
    const { registry, queryClient, todos, toReply } = setup()
    const cerrados = caseKeys.inbox({ status: 'closed', q: '' })
    const nuevos = caseKeys.inbox({ status: 'new', q: '' })
    queryClient.setQueryData(cerrados, makeInbox([]))
    queryClient.setQueryData(nuevos, makeInbox([]))
    const closed = makeCaseSummary({
      version: 9,
      status: 'closed',
      inboxStatus: 'closed',
      closedAt: NOW.toISOString(),
      closeReason: 'resolved',
    })
    registry.dispatch(envelope('case.updated', closed), queryClient)
    expect(queryClient.getQueryState(todos)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(toReply)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(cerrados)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(nuevos)?.isInvalidated).toBe(false)
  })

  it('refetches when the last interaction moves (the order changes), not on a new SLA stop', () => {
    const { registry, queryClient, todos } = setup()
    const responded = makeCaseSummary({ version: 4, firstResponseAt: NOW.toISOString() })
    registry.dispatch(envelope('case.updated', responded, 'EVT-2'), queryClient)
    expect(queryClient.getQueryState(todos)?.isInvalidated).toBe(false)
    const wrote = makeCaseSummary({ version: 5, lastInteractionAt: NOW.toISOString() })
    registry.dispatch(envelope('case.updated', wrote, 'EVT-3'), queryClient)
    expect(queryClient.getQueryState(todos)?.isInvalidated).toBe(true)
  })

  it('inbox.counts updates every cached inbox when newer, never with older counts', () => {
    const { registry, queryClient, todos, toReply } = setup()
    const later = new Date(NOW.getTime() + 1000).toISOString()
    registry.dispatch(
      envelope('inbox.counts', makeCounts({ all: 7, toReply: 3, closed: 4, computedAt: later })),
      queryClient,
    )
    expect(queryClient.getQueryData<InboxResponse>(todos)?.counts.all).toBe(7)
    expect(queryClient.getQueryData<InboxResponse>(toReply)?.counts.toReply).toBe(3)
    expect(queryClient.getQueryData<InboxResponse>(todos)?.counts.closed).toBe(4)

    const earlier = new Date(NOW.getTime() - 1000).toISOString()
    registry.dispatch(
      envelope('inbox.counts', makeCounts({ all: 1, computedAt: earlier })),
      queryClient,
    )
    expect(queryClient.getQueryData<InboxResponse>(todos)?.counts.all).toBe(7)
  })

  it('availability.updated replaces the cached availability', () => {
    const { registry, queryClient } = setup()
    queryClient.setQueryData(availabilityKeys.me(), available)
    registry.dispatch(envelope('availability.updated', paused), queryClient)
    expect(queryClient.getQueryData(availabilityKeys.me())).toEqual(paused)
  })

  it('ignores malformed payloads', () => {
    const { registry, queryClient, todos } = setup()
    const before = queryClient.getQueryData(todos)
    registry.dispatch(envelope('inbox.counts', { all: 'x' }), queryClient)
    registry.dispatch(envelope('availability.updated', null), queryClient)
    expect(queryClient.getQueryData(todos)).toBe(before)
    expect(queryClient.getQueryData(availabilityKeys.me())).toBeUndefined()
  })
})
