import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import * as rm from './model'
import {
  demoCustomers,
  fakeCustomerToken,
  makeCustomerConversation,
  makeCustomerTurn,
  makePastSummary,
  SIM_CUSTOMER_ID,
} from '@/test/conversation-fixtures'
import {
  addPendingCustomer,
  applyConversation,
  chatFromResponse,
  closedConversationNote,
  closedConversationsLine,
  chatLang,
  conversationStatusLine,
  customerChatCopy,
  decodeCustomerToken,
  describeStartFailure,
  emptyChat,
  endedSummary,
  hiddenPastCount,
  inputPlaceholder,
  isNewerConversation,
  isSameCase,
  localeLabel,
  mergeCustomerTurns,
  normalizeCustomerMessage,
  pastBlocks,
  pastBlockByline,
  pastBlockTitle,
  pastConversationsButton,
  pickerStatus,
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

  it('switches to a new case after a close, keeping the closed one as a past block', () => {
    const closed = mergeCustomerTurns(
      {
        ...emptyChat(),
        pastConversationCount: 1,
        conversation: makeCustomerConversation({
          caseId: 'CASE-OLD',
          status: 'closed',
          openedAt: '2026-03-05T15:00:00Z',
        }),
      },
      [makeCustomerTurn({ sequence: 1 })],
    )
    const next = applyConversation(
      addPendingCustomer(closed, pending('cm-2')),
      makeCustomerConversation({ previousCaseId: 'CASE-OLD' }),
    )
    expect(next.conversation?.caseId).toBe(makeCustomerConversation().caseId)
    expect(next.turns).toEqual([])
    expect(next.pending).toHaveLength(1)
    expect(next.ended).toEqual([{ conversation: closed.conversation, turns: closed.turns }])
    expect(next.pastConversationCount).toBe(2)
    // The same switch again (POST response, then the realtime echo) adds nothing.
    expect(applyConversation(next, next.conversation!)).toEqual(next)

    // A late update of the old case never switches the chat back.
    expect(applyConversation(next, closed.conversation!)).toBe(next)
    expect(isNewerConversation(closed.conversation!, next.conversation)).toBe(false)
    expect(isNewerConversation(makeCustomerConversation(), null)).toBe(true)
  })

  it('does not keep an open conversation as a past block', () => {
    const open = {
      ...emptyChat(),
      conversation: makeCustomerConversation({
        caseId: 'CASE-A',
        openedAt: '2026-03-05T15:00:00Z',
      }),
    }
    expect(applyConversation(open, makeCustomerConversation()).ended).toEqual([])
  })

  it('patches the same case in place', () => {
    const closed = mergeCustomerTurns(
      {
        ...emptyChat(),
        conversation: makeCustomerConversation({ caseId: 'CASE-OLD', status: 'closed' }),
      },
      [makeCustomerTurn({ sequence: 1 })],
    )
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
      {
        conversation: makeCustomerConversation(),
        turns: [makeCustomerTurn({ sequence: 1 })],
        pastConversationCount: 2,
      },
      previous,
    )
    expect(fresh.turns).toHaveLength(1)
    expect(fresh.pending).toHaveLength(1)
    expect(fresh.pastConversationCount).toBe(2)
    expect(
      chatFromResponse({ conversation: null, turns: [], pastConversationCount: 0 }, previous),
    ).toEqual({
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
        makeCustomerTurn({
          sequence: 6,
          kind: 'notice',
          authorRole: 'system',
          text: 'A conversa foi encerrada.',
        }),
      ]),
      pending('cm-5', 'obrigado'),
    )
    expect(toChatItems(chat).map((i) => [i.side, i.author, i.delivery])).toEqual([
      ['customer', null, 'sent'],
      ['notice', null, 'sent'],
      ['bank', 'Daniela, de LATAM Bank', 'sent'],
      ['notice', null, 'sent'],
      ['customer', null, 'sending'],
    ])
  })

  it('describes who is attending, in Spanish', () => {
    expect(conversationStatusLine(null, 'es')).toMatch(/Escribe tu mensaje/)
    expect(conversationStatusLine(makeCustomerConversation(), 'es')).toBe(
      'Buscando a una persona del equipo…',
    )
    expect(
      conversationStatusLine(
        makeCustomerConversation({ status: 'with_agent', agentName: 'Daniela' }),
        'es',
      ),
    ).toBe('Te atiende Daniela, de LATAM Bank')
    expect(conversationStatusLine(makeCustomerConversation({ status: 'with_agent' }), 'es')).toBe(
      'Te atiende una persona del equipo, de LATAM Bank',
    )
    expect(conversationStatusLine(makeCustomerConversation({ status: 'closed' }), 'es')).toBe(
      'Conversación terminada',
    )
  })

  it('describes who is attending, in Portuguese', () => {
    expect(conversationStatusLine(null, 'pt')).toBe(
      'Escreva sua mensagem e uma pessoa da equipe vai te atender',
    )
    expect(conversationStatusLine(makeCustomerConversation(), 'pt')).toBe(
      'Procurando uma pessoa da equipe…',
    )
    expect(
      conversationStatusLine(
        makeCustomerConversation({ status: 'with_agent', agentName: 'Daniela' }),
        'pt',
      ),
    ).toBe('Você está falando com Daniela, do LATAM Bank')
    expect(conversationStatusLine(makeCustomerConversation({ status: 'with_agent' }), 'pt')).toBe(
      'Você está falando com uma pessoa da equipe, do LATAM Bank',
    )
    expect(conversationStatusLine(makeCustomerConversation({ status: 'closed' }), 'pt')).toBe(
      'Conversa encerrada',
    )
  })

  it('has the whole chat copy in both languages', () => {
    const es = customerChatCopy('es')
    const pt = customerChatCopy('pt')
    expect(Object.keys(pt).sort()).toEqual(Object.keys(es).sort())
    expect(es).toMatchObject({ support: 'Soporte', greeting: 'Hola, ¿en qué te podemos ayudar?' })
    expect(pt).toMatchObject({
      support: 'Suporte',
      greeting: 'Olá, como podemos ajudar?',
      currentConversation: 'Conversa atual',
      retry: 'Tentar de novo',
    })
    expect(chatLang('pt')).toBe('pt-BR')
    expect(chatLang('es')).toBe('es')
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

  it('invites a new conversation once the current one is closed', () => {
    const closed = makeCustomerConversation({ status: 'closed' })
    expect(inputPlaceholder(closed, 'es')).toBe('Escribe para empezar una nueva conversación')
    expect(inputPlaceholder(makeCustomerConversation(), 'es')).toBe('Escribe aquí')
    expect(inputPlaceholder(null, 'es')).toBe('Escribe aquí')
    expect(closedConversationNote(closed, 'es')).toBe(
      'Esta conversación terminó. Si escribes, empezamos una nueva.',
    )
    expect(closedConversationNote(makeCustomerConversation(), 'es')).toBeNull()
    // Portuguese (rule 3 demo: the customer comes back after a close).
    expect(inputPlaceholder(closed, 'pt')).toBe('Escreva para começar uma nova conversa')
    expect(inputPlaceholder(null, 'pt')).toBe('Escreva aqui')
    expect(closedConversationNote(closed, 'pt')).toBe(
      'Esta conversa terminou. Se você escrever, começamos uma nova.',
    )
    expect(closedConversationNote(makeCustomerConversation(), 'pt')).toBeNull()
  })

  it('formats the picker labels and failures', () => {
    expect(localeLabel('es-AR')).toBe('Español de Argentina')
    expect(placeLabel('Buenos Aires', 'AR')).toBe('Buenos Aires, Argentina')
    expect(placeLabel('São Paulo', 'BR')).toBe('São Paulo, Brasil')
    expect(normalizeCustomerMessage('  oi ')).toBe('oi')
    expect(normalizeCustomerMessage(' ')).toBeNull()
    expect(describeStartFailure(new ApiProblem({ status: 404, code: 'not_found' }))).toMatch(
      /Elige otro/,
    )
    expect(describeStartFailure(ApiProblem.network())).toMatch(/backend/)
  })
})

describe('picker', () => {
  it('badges an open conversation, or one still waiting for a person', () => {
    const [rafael, joaquin, claudia, gabriela] = demoCustomers
    expect(pickerStatus(rafael!)).toBeNull()
    expect(pickerStatus(joaquin!)).toEqual({
      shape: 'pie-50',
      tone: 'success',
      label: 'Conversación abierta',
    })
    expect(pickerStatus(gabriela!)).toEqual({
      shape: 'dashed',
      tone: 'warn',
      label: 'Esperando a una persona',
      strong: true,
    })
    expect(closedConversationsLine(claudia!.closedConversationCount)).toBe(
      '1 conversación anterior',
    )
    expect(closedConversationsLine(3)).toBe('3 conversaciones anteriores')
    expect(closedConversationsLine(0)).toBeNull()
  })
})

describe('past conversations', () => {
  it('counts the ones not on screen yet and labels the button', () => {
    const chat = { ...emptyChat(), pastConversationCount: 3 }
    expect(hiddenPastCount(chat)).toBe(3)
    const ended = {
      conversation: makeCustomerConversation({ status: 'closed' }),
      turns: [makeCustomerTurn()],
    }
    expect(hiddenPastCount({ ...chat, ended: [ended] })).toBe(2)
    expect(hiddenPastCount({ pastConversationCount: 0, ended: [ended] })).toBe(0)
    expect(pastConversationsButton(2, 'es')).toBe('Ver conversaciones anteriores (2)')
    expect(pastConversationsButton(2, 'pt')).toBe('Ver conversas anteriores (2)')
    expect(pastConversationsButton(0, 'es')).toBeNull()
    expect(pastConversationsButton(0, 'pt')).toBeNull()
  })

  it('renders the server list oldest at the top, without the ones that ended here', () => {
    const newest = makePastSummary({ caseId: 'CASE-3', openedAt: '2026-03-04T10:00:00Z' })
    const middle = makePastSummary({ caseId: 'CASE-2', openedAt: '2026-03-02T10:00:00Z' })
    const oldest = makePastSummary({ caseId: 'CASE-1', openedAt: '2026-02-20T10:00:00Z' })
    const endedHere = {
      conversation: makeCustomerConversation({ caseId: 'CASE-3', status: 'closed' }),
      turns: [],
    }
    expect(pastBlocks([newest, middle, oldest], [endedHere]).map((b) => b.caseId)).toEqual([
      'CASE-1',
      'CASE-2',
    ])
  })

  it('titles a block with its date and says who attended it on its own line', () => {
    expect(pastBlockTitle(makePastSummary(), 'es')).toBe('Conversación del 4 mar 2026')
    expect(pastBlockByline(makePastSummary(), 'es')).toBe('Te atendió Daniela')
    expect(pastBlockByline(makePastSummary({ agentName: null }), 'es')).toBeNull()
    expect(pastBlockTitle(makePastSummary(), 'pt')).toBe('Conversa de 4 mar 2026')
    expect(pastBlockByline(makePastSummary(), 'pt')).toBe('Atendida por Daniela')
    expect(pastBlockTitle(makePastSummary({ openedAt: '2026-02-10T15:00:00Z' }), 'pt')).toBe(
      'Conversa de 10 fev 2026',
    )
  })

  it('turns a conversation that ended here into a block with its last message', () => {
    const conversation = makeCustomerConversation({
      caseId: 'CASE-9',
      status: 'closed',
      agentName: 'Daniela',
      closedAt: '2026-03-05T16:30:00Z',
    })
    const turns = [
      makeCustomerTurn({ sequence: 1, text: 'Olá' }),
      makeCustomerTurn({ sequence: 2, kind: 'notice', authorRole: 'system', text: 'Encerrada.' }),
    ]
    expect(endedSummary({ conversation, turns })).toEqual({
      caseId: 'CASE-9',
      status: 'closed',
      channel: 'chat_app',
      openedAt: conversation.openedAt,
      closedAt: '2026-03-05T16:30:00Z',
      agentName: 'Daniela',
      preview: 'Olá',
    })
  })
})

describe('satisfaction survey (slice 7)', () => {
  const closed = makeCustomerConversation({ status: 'closed', agentName: 'Daniela' })

  it('asks only for the current closed conversation, unrated and not skipped', () => {
    expect(rm.surveyState(null, new Set())).toBe('none')
    expect(rm.surveyState(makeCustomerConversation({ status: 'with_agent' }), new Set())).toBe(
      'none',
    )
    expect(rm.surveyState(closed, new Set())).toBe('ask')
    expect(rm.surveyState(closed, new Set([closed.caseId]))).toBe('none')
    const rated = {
      ...closed,
      rating: { score: 3, comment: null, ratedAt: '2026-03-05T17:00:00Z' },
    }
    expect(rm.surveyState(rated, new Set())).toBe('rated')
    // Rated wins over a skip (the thanks still shows).
    expect(rm.surveyState(rated, new Set([closed.caseId]))).toBe('rated')
  })

  it('names the four answers with a face and a tone, in each language', () => {
    expect(rm.ratingOptions('es')).toEqual([
      { score: 1, label: 'Mal', icon: 'frown', tone: 'danger' },
      { score: 2, label: 'Regular', icon: 'meh', tone: 'warn' },
      { score: 3, label: 'Bien', icon: 'smile', tone: 'good' },
      { score: 4, label: 'Excelente', icon: 'laugh', tone: 'great' },
    ])
    expect(rm.ratingOptions('pt').map((option) => option.label)).toEqual([
      'Ruim',
      'Regular',
      'Bom',
      'Excelente',
    ])
    expect(rm.customerRatingOption(9, 'es').label).toBe('Excelente')
    expect(rm.customerRatingOption(0, 'pt').label).toBe('Ruim')
  })

  it('writes the survey copy with the analyst, or the team when unknown', () => {
    expect(rm.ratingSurveyCopy('Daniela', 'es')).toMatchObject({
      title: '¿Cómo te atendió Daniela?',
      legend: 'Califica la atención',
      commentLabel: '¿Quieres contarnos algo más? (opcional)',
      skip: 'Ahora no',
      send: 'Enviar',
    })
    expect(rm.ratingSurveyCopy(null, 'es').title).toBe('¿Cómo te atendió nuestro equipo?')
    expect(rm.ratingSurveyCopy('Daniela', 'pt')).toMatchObject({
      title: 'Como foi o atendimento de Daniela?',
      legend: 'Avalie o atendimento',
      skip: 'Agora não',
    })
    expect(rm.ratingSurveyCopy(null, 'pt').title).toBe('Como foi o atendimento de nossa equipe?')
    expect(rm.ratedThanks({ score: 4 }, 'es')).toBe('¡Gracias! Calificaste: Excelente')
    expect(rm.ratedThanks({ score: 3 }, 'pt')).toBe('Obrigado! Você avaliou: Bom')
  })

  it('trims the comment (blank → null, at most 500)', () => {
    expect(rm.toRatingRequest(4, '  Muy amable ')).toEqual({ score: 4, comment: 'Muy amable' })
    expect(rm.toRatingRequest(1, '   ')).toEqual({ score: 1, comment: null })
    expect(rm.toRatingRequest(2, 'x'.repeat(600)).comment).toHaveLength(500)
  })

  it('explains a failed send and refetches when the conversation changed', () => {
    const network = new ApiProblem({ status: 0, code: 'network_error' })
    const rated = new ApiProblem({ status: 409, code: 'already_rated' })
    expect(rm.describeRatingFailure(network, 'es')).toBe('No hay conexión. Inténtalo de nuevo.')
    expect(rm.describeRatingFailure(rated, 'pt')).toBe(
      'Não foi possível enviar sua avaliação. Tente de novo.',
    )
    expect(rm.ratingFailureRefetches(rated)).toBe(true)
    expect(
      rm.ratingFailureRefetches(new ApiProblem({ status: 409, code: 'case_not_closed' })),
    ).toBe(true)
    expect(rm.ratingFailureRefetches(network)).toBe(false)
  })

  it('remembers skipped conversations in a forgiving format', () => {
    expect(rm.parseSkippedRatings(null)).toEqual(new Set())
    expect(rm.parseSkippedRatings('not json')).toEqual(new Set())
    expect(rm.parseSkippedRatings('{"a":1}')).toEqual(new Set())
    expect(rm.parseSkippedRatings('["CASE-1", 2, "CASE-2"]')).toEqual(new Set(['CASE-1', 'CASE-2']))
    const many = new Set(Array.from({ length: 60 }, (_, i) => `CASE-${i}`))
    const stored = JSON.parse(rm.serializeSkippedRatings(many)) as string[]
    expect(stored).toHaveLength(50)
    expect(stored.at(-1)).toBe('CASE-59')
  })
})
