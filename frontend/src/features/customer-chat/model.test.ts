import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import {
  fakeCustomerToken,
  makeCustomerConversation,
  makeCustomerTurn,
  SIM_CUSTOMER_ID,
} from '@/test/conversation-fixtures'
import {
  addPendingCustomer,
  applyConversation,
  chatFromResponse,
  conversationStatusLine,
  decodeCustomerToken,
  describeStartFailure,
  emptyChat,
  isSameCase,
  localeLabel,
  mergeCustomerTurns,
  normalizeCustomerMessage,
  placeLabel,
  setPendingStatus,
  toChatItems,
  visibleSuggestions,
} from './model'
import type { PendingCustomerMessage } from './types'

const pending = (clientMessageId: string, text = 'oi'): PendingCustomerMessage => ({
  clientMessageId,
  text,
  createdAt: '2026-03-05T16:00:00Z',
  status: 'sending',
})

describe('decodeCustomerToken', () => {
  it('reads the customer and the expiry of a valid token', () => {
    const claims = decodeCustomerToken(fakeCustomerToken(SIM_CUSTOMER_ID), Date.now())
    expect(claims?.customerId).toBe(SIM_CUSTOMER_ID)
    expect(claims?.expiresAt).toBeGreaterThan(Date.now())
  })

  it('rejects expired, foreign-audience and malformed tokens', () => {
    const now = Date.now()
    expect(
      decodeCustomerToken(fakeCustomerToken(SIM_CUSTOMER_ID, { expiresInSeconds: -5 }), now),
    ).toBeNull()
    expect(
      decodeCustomerToken(fakeCustomerToken(SIM_CUSTOMER_ID, { aud: 'cc-staff' }), now),
    ).toBeNull()
    expect(decodeCustomerToken(fakeCustomerToken('STF-1'), now)).toBeNull()
    expect(decodeCustomerToken('not-a-jwt', now)).toBeNull()
    expect(decodeCustomerToken('a.###.c', now)).toBeNull()
  })
})

describe('chat cache', () => {
  it('dedupes by id, orders by sequence and confirms pending messages', () => {
    const base = addPendingCustomer(
      { ...emptyChat(), conversation: makeCustomerConversation() },
      pending('cm-1'),
    )
    const merged = mergeCustomerTurns(base, [
      makeCustomerTurn({
        sequence: 4,
        kind: 'notice',
        authorRole: 'system',
        text: 'Recebemos sua mensagem.',
      }),
      makeCustomerTurn({ sequence: 1, clientMessageId: 'cm-1' }),
      makeCustomerTurn({ sequence: 1, clientMessageId: 'cm-1' }),
    ])
    expect(merged.turns.map((t) => t.sequence)).toEqual([1, 4])
    expect(merged.pending).toEqual([])
    expect(mergeCustomerTurns(merged, [makeCustomerTurn({ sequence: 4 })])).toBe(merged)
  })

  it('starts an empty transcript when a new case replaces the closed one', () => {
    const closed = mergeCustomerTurns(
      {
        ...emptyChat(),
        conversation: makeCustomerConversation({ caseId: 'CASE-OLD', status: 'closed' }),
      },
      [makeCustomerTurn({ sequence: 1 })],
    )
    const next = applyConversation(
      addPendingCustomer(closed, pending('cm-2')),
      makeCustomerConversation(),
    )
    expect(next.turns).toEqual([])
    expect(next.pending).toHaveLength(1)
    const same = applyConversation(
      closed,
      makeCustomerConversation({ caseId: 'CASE-OLD', status: 'with_agent' }),
    )
    expect(same.turns).toHaveLength(1)
    expect(isSameCase(same, 'CASE-OLD')).toBe(true)
    expect(isSameCase(same, null)).toBe(false)
  })

  it('merges a fetched conversation and keeps messages still being sent', () => {
    const previous = addPendingCustomer(emptyChat(), pending('cm-3'))
    const fresh = chatFromResponse(
      { conversation: makeCustomerConversation(), turns: [makeCustomerTurn({ sequence: 1 })] },
      previous,
    )
    expect(fresh.turns).toHaveLength(1)
    expect(fresh.pending).toHaveLength(1)
    expect(chatFromResponse({ conversation: null, turns: [] }, previous)).toEqual({
      ...emptyChat(),
      pending: previous.pending,
    })
  })

  it('marks pending messages failed and back to sending', () => {
    const chat = addPendingCustomer(emptyChat(), pending('cm-4'))
    expect(setPendingStatus(chat, 'cm-4', 'failed').pending[0]?.status).toBe('failed')
    expect(setPendingStatus(chat, 'nope', 'failed')).toBe(chat)
  })
})

describe('what the chat shows', () => {
  it('puts the customer on one side and the bank on the other', () => {
    const chat = addPendingCustomer(
      mergeCustomerTurns(emptyChat(), [
        makeCustomerTurn({ sequence: 1 }),
        makeCustomerTurn({
          sequence: 2,
          kind: 'notice',
          authorRole: 'system',
          text: 'Recebemos sua mensagem.',
        }),
        makeCustomerTurn({
          sequence: 4,
          authorRole: 'analyst',
          authorName: 'Daniela',
          text: 'Olá, Rafael!',
        }),
        makeCustomerTurn({ sequence: 5, authorRole: 'bot', text: 'Posso ajudar?' }),
      ]),
      pending('cm-5', 'obrigado'),
    )
    expect(toChatItems(chat).map((i) => [i.side, i.author, i.delivery])).toEqual([
      ['customer', null, 'sent'],
      ['notice', null, 'sent'],
      ['bank', 'Daniela · LATAM Bank', 'sent'],
      ['bank', 'Asistente automático', 'sent'],
      ['customer', null, 'sending'],
    ])
  })

  it('describes who is attending', () => {
    expect(conversationStatusLine(null)).toMatch(/Escribe tu mensaje/)
    expect(conversationStatusLine(makeCustomerConversation())).toBe(
      'Buscando a una persona del equipo…',
    )
    expect(
      conversationStatusLine(
        makeCustomerConversation({ status: 'with_agent', agentName: 'Daniela' }),
      ),
    ).toBe('Te atiende Daniela · LATAM Bank')
    expect(conversationStatusLine(makeCustomerConversation({ status: 'closed' }))).toBe(
      'Conversación terminada',
    )
  })

  it('offers the chips whether the conversation is absent, open or closed', () => {
    const chips = ['Fue a mediados de mes, unos $48.300', '¿Lo pudiste encontrar?']
    expect(visibleSuggestions(chips, undefined)).toEqual([])
    expect(visibleSuggestions(chips, emptyChat())).toEqual(chips)
    // Joaquín's open chat (with_agent): his follow-ups are the demo story.
    const open = mergeCustomerTurns(
      { ...emptyChat(), conversation: makeCustomerConversation({ status: 'with_agent' }) },
      [makeCustomerTurn({ sequence: 1, text: 'Hola, no reconozco un cargo' })],
    )
    expect(visibleSuggestions(chips, open)).toEqual(chips)
    const closed = { ...open, conversation: makeCustomerConversation({ status: 'closed' }) }
    expect(visibleSuggestions(chips, closed)).toEqual(chips)
  })

  it('hides the chips while sending and drops the ones already sent', () => {
    const chips = ['Fue a mediados de mes, unos $48.300', '¿Lo pudiste encontrar?']
    const open = {
      ...emptyChat(),
      conversation: makeCustomerConversation({ status: 'with_agent' }),
    }
    const sending = addPendingCustomer(open, pending('cm-1', chips[0]))
    expect(visibleSuggestions(chips, sending)).toEqual([])
    const sent = mergeCustomerTurns(sending, [
      makeCustomerTurn({ sequence: 3, text: chips[0], clientMessageId: 'cm-1' }),
    ])
    expect(visibleSuggestions(chips, sent)).toEqual(['¿Lo pudiste encontrar?'])
  })

  it('keeps the same key from "Enviando…" to sent', () => {
    const sending = addPendingCustomer(emptyChat(), pending('cm-7', 'oi'))
    expect(toChatItems(sending)[0]?.key).toBe('cm-7')
    const sent = mergeCustomerTurns(sending, [
      makeCustomerTurn({ sequence: 1, text: 'oi', clientMessageId: 'cm-7' }),
    ])
    expect(toChatItems(sent)[0]).toMatchObject({ key: 'cm-7', delivery: 'sent' })
    expect(toChatItems(mergeCustomerTurns(emptyChat(), [makeCustomerTurn()]))[0]?.key).toBe(
      'TRN-C0001',
    )
  })

  it('formats the picker labels and failures', () => {
    expect(localeLabel('es-AR')).toBe('Español de Argentina')
    expect(placeLabel('Buenos Aires', 'AR')).toBe('Buenos Aires, Argentina')
    expect(normalizeCustomerMessage('  oi ')).toBe('oi')
    expect(normalizeCustomerMessage(' ')).toBeNull()
    expect(describeStartFailure(new ApiProblem({ status: 404, code: 'not_found' }))).toMatch(
      /Elige otro/,
    )
    expect(describeStartFailure(ApiProblem.network())).toMatch(/backend/)
  })
})
