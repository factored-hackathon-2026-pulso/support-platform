import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { makeCustomerCall } from '@/test/channel-fixtures'
import { makeCustomerConversation, makeCustomerTurn } from '@/test/conversation-fixtures'
import {
  CHANNEL_OPTIONS,
  channelFromSlug,
  chatTurns,
  customerCallLines,
  customerCallPhase,
  customerCallSeconds,
  customerCallSubline,
  customerCallTitle,
  customerMailItems,
  customerReplySubject,
  customerThreadSubject,
  describeCustomerCallFailure,
  emailAsTurn,
  isIncomingCall,
  isNewerCustomerCall,
  mailComposeMode,
  slugFromChannel,
  validateCustomerEmail,
} from './channels'
import { emptyChat } from './model'

describe('the channel picked', () => {
  it('maps the three cards to ?canal= and back', () => {
    expect(CHANNEL_OPTIONS.map((option) => option.title)).toEqual([
      'Chat',
      'Llamar',
      'Escribir un correo',
    ])
    expect(slugFromChannel('call')).toBe('llamada')
    expect(slugFromChannel('mail')).toBe('correo')
    expect(channelFromSlug('chat')).toBe('chat')
    expect(channelFromSlug('llamada')).toBe('call')
    expect(channelFromSlug('correo')).toBe('mail')
    expect(channelFromSlug('fax')).toBeNull()
    expect(channelFromSlug(null)).toBeNull()
  })

  it('keeps call lines and emails out of the chat view', () => {
    const cache = {
      ...emptyChat(),
      turns: [
        makeCustomerTurn({ sequence: 1 }),
        makeCustomerTurn({ sequence: 2, kind: 'transcript' }),
        makeCustomerTurn({ sequence: 3, kind: 'email', subject: 'x' }),
        makeCustomerTurn({ sequence: 4, kind: 'notice', authorRole: 'system' }),
      ],
    }
    expect(chatTurns(cache).turns.map((turn) => turn.sequence)).toEqual([1, 4])
    const plain = { ...emptyChat(), turns: [makeCustomerTurn()] }
    expect(chatTurns(plain)).toBe(plain)
  })
})

describe('the call, as the customer lives it', () => {
  it('names every phase', () => {
    expect(customerCallPhase(null)).toBe('none')
    expect(customerCallPhase(makeCustomerCall({ state: 'ringing' }))).toBe('dialing')
    expect(customerCallPhase(makeCustomerCall({ state: 'ringing', direction: 'outbound' }))).toBe(
      'incoming',
    )
    expect(customerCallPhase(makeCustomerCall())).toBe('live')
    expect(customerCallPhase(makeCustomerCall({ state: 'on_hold' }))).toBe('hold')
    expect(customerCallPhase(makeCustomerCall({ state: 'ended' }))).toBe('ended')
    expect(isIncomingCall(makeCustomerCall({ state: 'ringing', direction: 'outbound' }))).toBe(true)
    expect(isIncomingCall(makeCustomerCall({ state: 'ringing' }))).toBe(false)
  })

  it('titles the call in Spanish and Portuguese', () => {
    const ringing = makeCustomerCall({ state: 'ringing', answeredAt: null })
    expect(customerCallTitle(ringing, 'es')).toBe('Llamando…')
    expect(customerCallTitle(ringing, 'pt')).toBe('Ligando…')
    expect(customerCallTitle(makeCustomerCall(), 'es')).toBe('Te atiende Daniela')
    expect(customerCallTitle(makeCustomerCall(), 'pt')).toBe('Você está falando com Daniela')
    expect(customerCallTitle(makeCustomerCall({ state: 'on_hold' }), 'es')).toBe(
      'Daniela te puso en espera',
    )
    expect(
      customerCallTitle(makeCustomerCall({ state: 'ringing', direction: 'outbound' }), 'es'),
    ).toBe('LATAM Bank te está llamando')
    expect(
      customerCallTitle(makeCustomerCall({ state: 'ringing', direction: 'outbound' }), 'pt'),
    ).toBe('O LATAM Bank está te ligando')
    const ended = makeCustomerCall({ state: 'ended', durationSeconds: 252, endReason: 'completed' })
    expect(customerCallTitle(ended, 'es')).toBe('Llamada terminada, 4 min 12 s')
    expect(customerCallTitle(ended, 'pt')).toBe('Ligação encerrada, 4 min 12 s')
    expect(
      customerCallTitle(
        makeCustomerCall({ state: 'ended', endReason: 'rejected', answeredAt: null }),
        'es',
      ),
    ).toBe('Rechazaste la llamada')
    expect(
      customerCallTitle(
        makeCustomerCall({ state: 'ended', endReason: 'cancelled', answeredAt: null }),
        'es',
      ),
    ).toBe('Llamada terminada sin respuesta')
    expect(customerCallSubline(ringing, 'es')).toBe('Línea de atención LATAM Bank')
    expect(customerCallSubline(makeCustomerCall(), 'es')).toBeNull()
    expect(customerCallSubline(ended, 'es')).toMatch(/vuelve a llamar/)
  })

  it('runs the timer from the call times', () => {
    expect(customerCallSeconds(makeCustomerCall(), '2026-03-05T16:01:20Z')).toBe(60)
    expect(
      customerCallSeconds(
        makeCustomerCall({ state: 'ringing', answeredAt: null }),
        '2026-03-05T16:00:05Z',
      ),
    ).toBe(5)
    expect(customerCallSeconds(makeCustomerCall({ state: 'ended', durationSeconds: 9 }), 0)).toBe(9)
  })

  it('keeps an ended call final and takes a newer call', () => {
    const live = makeCustomerCall()
    const ended = makeCustomerCall({ state: 'ended' })
    expect(isNewerCustomerCall(live, null)).toBe(true)
    expect(isNewerCustomerCall(ended, live)).toBe(true)
    expect(isNewerCustomerCall(live, ended)).toBe(false)
    expect(
      isNewerCustomerCall(
        makeCustomerCall({ id: 'CALL-2', startedAt: '2026-03-05T17:00:00Z' }),
        ended,
      ),
    ).toBe(true)
  })

  it('shows the lines of this call only, timed from the answer', () => {
    const at = (seconds: number) =>
      new Date(Date.UTC(2026, 2, 5, 16, 0, 20) + seconds * 1000).toISOString()
    const turns = [
      makeCustomerTurn({ sequence: 1, text: 'Hola del chat', createdAt: at(-600) }),
      makeCustomerTurn({
        sequence: 2,
        kind: 'transcript',
        authorRole: 'analyst',
        authorName: 'Daniela',
        text: 'Buenas tardes',
        createdAt: at(0),
      }),
      makeCustomerTurn({
        sequence: 3,
        kind: 'transcript',
        authorRole: 'customer',
        text: 'Hola',
        createdAt: at(6),
      }),
      makeCustomerTurn({
        sequence: 4,
        kind: 'transcript',
        authorRole: 'system',
        text: 'Llamada en espera.',
        createdAt: at(44),
      }),
    ]
    expect(customerCallLines(turns, makeCustomerCall(), 'es')).toEqual([
      { key: turns[1]?.id, side: 'bank', who: 'Daniela', time: '00:00', text: 'Buenas tardes' },
      { key: turns[2]?.id, side: 'me', who: 'Tú', time: '00:06', text: 'Hola' },
      { key: turns[3]?.id, side: 'system', who: null, time: '00:44', text: 'Llamada en espera.' },
    ])
    expect(customerCallLines(turns, makeCustomerCall(), 'pt')[1]?.who).toBe('Você')
    expect(customerCallLines(turns, null, 'es')).toEqual([])
  })

  it('explains failures in the customer language', () => {
    const busy = new ApiProblem({ status: 409, code: 'call_in_progress' })
    expect(describeCustomerCallFailure(busy, 'es')).toBe('Ya tienes una llamada en curso.')
    expect(describeCustomerCallFailure(busy, 'pt')).toBe('Você já tem uma ligação em andamento.')
  })
})

describe('the email thread, as the customer reads it', () => {
  const thread = [
    makeCustomerTurn({
      sequence: 1,
      kind: 'email',
      authorRole: 'customer',
      subject: 'Cobro',
      text: 'Hola',
    }),
    makeCustomerTurn({
      sequence: 2,
      kind: 'notice',
      authorRole: 'system',
      text: 'Recibimos tu correo.',
    }),
    makeCustomerTurn({
      sequence: 3,
      kind: 'email',
      authorRole: 'analyst',
      authorName: 'Daniela',
      subject: 'Re: Cobro',
      text: 'Hola, Marcela:',
    }),
  ]

  it('marks the bank replies after the customer last wrote as new, and opens the newest', () => {
    const items = customerMailItems(thread, 'es')
    expect(items.map((item) => [item.kind, item.from, item.isNew, item.latest])).toEqual([
      ['mail', 'Tú', false, false],
      ['notice', 'LATAM Bank', false, false],
      ['mail', 'Daniela, LATAM Bank', true, true],
    ])
    const answered = [
      ...thread,
      makeCustomerTurn({
        sequence: 4,
        kind: 'email',
        authorRole: 'customer',
        subject: 'Re: Cobro',
      }),
    ]
    expect(customerMailItems(answered, 'pt').filter((item) => item.isNew)).toEqual([])
    expect(customerMailItems(answered, 'pt')[0]?.from).toBe('Você')
  })

  it('writes a new email or replies in the thread', () => {
    expect(customerThreadSubject(thread)).toBe('Cobro')
    expect(customerThreadSubject([])).toBeNull()
    const open = makeCustomerConversation({ status: 'with_agent' })
    expect(mailComposeMode(open, 'Cobro')).toBe('reply')
    expect(mailComposeMode(open, null)).toBe('new')
    expect(mailComposeMode(makeCustomerConversation({ status: 'closed' }), 'Cobro')).toBe('new')
    expect(mailComposeMode(null, null)).toBe('new')
    expect(customerReplySubject('Cobro')).toBe('Re: Cobro')
    expect(customerReplySubject('Re: Cobro')).toBe('Re: Cobro')
  })

  it('validates before sending, in the customer language', () => {
    expect(validateCustomerEmail('new', '', 'Hola', 'es')).toBe('Escribe el asunto y el mensaje.')
    expect(validateCustomerEmail('new', 'Cobro', '', 'pt')).toBe('Escreva o assunto e a mensagem.')
    expect(validateCustomerEmail('reply', '', ' ', 'es')).toBe('Escribe tu respuesta.')
    expect(validateCustomerEmail('reply', '', 'Gracias', 'es')).toBeNull()
  })

  it('turns the sent email into a turn of the conversation', () => {
    expect(
      emailAsTurn(
        {
          id: 'TRN-1',
          sequence: 1,
          direction: 'in',
          subject: 'Cobro',
          body: 'Hola',
          authorName: 'Marcela',
          createdAt: '2026-03-05T16:00:00Z',
          clientMessageId: 'k',
        },
        'es',
      ),
    ).toMatchObject({ kind: 'email', authorRole: 'customer', text: 'Hola', subject: 'Cobro' })
  })
})
