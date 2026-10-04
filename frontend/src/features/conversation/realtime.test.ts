import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnvelopeHandlerRegistry, type EnvelopeHandlerRegistry } from '@/lib/realtime'
import {
  CASE_ID,
  envelope,
  makeAnalystTurn,
  makeAnsweredEscalation,
  makeCaseDetail,
  makeEscalation,
  makeTurn,
  seededTurns,
} from '@/test/conversation-fixtures'
import { conversationKeys } from './api'
import { addPending, emptyTranscript, mergeTurns } from './model'
import { registerConversationRealtime } from './realtime'
import type { CaseDetail, TranscriptCache } from './types'

let queryClient: QueryClient
let registry: EnvelopeHandlerRegistry

beforeEach(() => {
  queryClient = new QueryClient()
  registry = createEnvelopeHandlerRegistry()
  registerConversationRealtime(registry)
})

const turnsKey = conversationKeys.turns(CASE_ID)
const detailKey = conversationKeys.detail(CASE_ID)
const transcript = () => queryClient.getQueryData<TranscriptCache>(turnsKey)

function seed(cache: TranscriptCache = mergeTurns(emptyTranscript(), seededTurns())) {
  queryClient.setQueryData(turnsKey, cache)
}

describe('turn.created', () => {
  it('appends the next turn to the open transcript', () => {
    seed()
    expect(
      registry.dispatch(
        envelope('turn.created', makeTurn({ sequence: 5, text: 'hola?' })),
        queryClient,
      ),
    ).toBe(1)
    expect(transcript()?.turns.map((t) => t.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(transcript()?.contiguousSequence).toBe(5)
  })

  it('is idempotent: the same envelope twice is one turn', () => {
    seed()
    const event = envelope('turn.created', makeTurn({ sequence: 5 }))
    registry.dispatch(event, queryClient)
    const once = transcript()
    registry.dispatch(event, queryClient)
    expect(transcript()).toBe(once)
  })

  it('replaces the pending message its echo confirms', () => {
    seed(
      addPending(mergeTurns(emptyTranscript(), seededTurns()), {
        clientMessageId: 'cm-1',
        text: 'Hola, Marcela',
        createdAt: '2026-03-05T16:00:00Z',
        status: 'sending',
        error: null,
        retryable: false,
      }),
    )
    registry.dispatch(
      envelope('turn.created', makeAnalystTurn(5, 'Hola, Marcela', 'cm-1')),
      queryClient,
    )
    expect(transcript()?.pending).toEqual([])
    expect(transcript()?.turns.at(-1)?.clientMessageId).toBe('cm-1')
  })

  it('refetches instead of merging when sequences were skipped (gap fill)', () => {
    seed()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    registry.dispatch(envelope('turn.created', makeTurn({ sequence: 8 })), queryClient)
    expect(transcript()?.contiguousSequence).toBe(4)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: turnsKey, exact: true })
  })

  it('ignores cases nobody has open and malformed payloads', () => {
    registry.dispatch(envelope('turn.created', makeTurn({ sequence: 1 })), queryClient)
    expect(transcript()).toBeUndefined()
    seed()
    const before = transcript()
    registry.dispatch(envelope('turn.created', { id: 42 }), queryClient)
    expect(transcript()).toBe(before)
  })
})

describe('case.updated / case.assigned', () => {
  const detail = () => queryClient.getQueryData<CaseDetail>(detailKey)

  it('patches the cached detail with a newer summary', () => {
    const cached = makeCaseDetail()
    queryClient.setQueryData(detailKey, cached)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    registry.dispatch(
      envelope('case.updated', {
        ...cached.case,
        version: cached.case.version + 1,
        unreadCount: 2,
      }),
      queryClient,
    )
    expect(detail()?.case.unreadCount).toBe(2)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('ignores stale or repeated versions', () => {
    const cached = makeCaseDetail()
    queryClient.setQueryData(detailKey, cached)
    registry.dispatch(envelope('case.updated', { ...cached.case, unreadCount: 7 }), queryClient)
    registry.dispatch(
      envelope('case.assigned', { ...cached.case, version: cached.case.version - 1 }),
      queryClient,
    )
    expect(detail()).toBe(cached)
  })

  it('refetches the detail when the status changes (capabilities, closure)', () => {
    const cached = makeCaseDetail()
    queryClient.setQueryData(detailKey, cached)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    registry.dispatch(
      envelope('case.updated', {
        ...cached.case,
        version: cached.case.version + 1,
        status: 'closed',
      }),
      queryClient,
    )
    expect(detail()?.case.status).toBe('closed')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: detailKey, exact: true })
  })

  it('does nothing for cases whose detail is not cached', () => {
    registry.dispatch(envelope('case.updated', makeCaseDetail().case), queryClient)
    expect(detail()).toBeUndefined()
  })
})

describe('escalation.updated (slice 9)', () => {
  it('puts the newer state of the escalation in the open detail and refetches it', () => {
    queryClient.setQueryData(detailKey, makeCaseDetail({ escalation: makeEscalation() }))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    registry.dispatch(envelope('escalation.updated', makeAnsweredEscalation()), queryClient)
    const detail = queryClient.getQueryData<CaseDetail>(detailKey)
    expect(detail?.escalation?.state).toBe('answered')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: detailKey, exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: turnsKey, exact: true })
  })

  it('keeps a newer escalation over a late one of an older escalation', () => {
    const newer = makeEscalation({ id: 'ESC-NEWER', escalatedAt: '2026-03-05T15:58:00Z' })
    queryClient.setQueryData(detailKey, makeCaseDetail({ escalation: newer }))
    registry.dispatch(envelope('escalation.updated', makeAnsweredEscalation()), queryClient)
    expect(queryClient.getQueryData<CaseDetail>(detailKey)?.escalation?.id).toBe('ESC-NEWER')
  })

  it('ignores a case nobody has open and a malformed payload', () => {
    registry.dispatch(envelope('escalation.updated', makeEscalation()), queryClient)
    expect(queryClient.getQueryData(detailKey)).toBeUndefined()
    queryClient.setQueryData(detailKey, makeCaseDetail())
    registry.dispatch(envelope('escalation.updated', { id: 1 }), queryClient)
    expect(queryClient.getQueryData<CaseDetail>(detailKey)?.escalation).toBeNull()
  })
})
