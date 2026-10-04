import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { makeCall, makeEmail, makeLine } from '@/test/channel-fixtures'
import { makeCaseDetail, makeTurn } from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import {
  CALL_STATUS,
  applyCallToDetail,
  barCall,
  callControls,
  callDirectionFact,
  callElapsedSeconds,
  callEventKind,
  callForTime,
  callStateLabel,
  centerMode,
  closeNoticeChannel,
  describeCallFailure,
  describeWriteFailure,
  emailSnippet,
  emailToTurn,
  formatCallDuration,
  lineOffset,
  outboundReason,
  replySubject,
  threadSubject,
  transcriptCaption,
  unansweredEmailIds,
  upsertCall,
  validateCallReason,
} from './channels'
import { describeCloseFailure, toTranscriptItems } from './model'

const ME = analystStaff.id

describe('which central panel', () => {
  it('follows the channel the case opened by', () => {
    const detail = makeCaseDetail()
    expect(centerMode(detail)).toBe('chat')
    expect(centerMode({ ...detail, case: { ...detail.case, channel: 'chat_app' } })).toBe('chat')
    expect(centerMode({ ...detail, case: { ...detail.case, channel: 'phone_inbound' } })).toBe(
      'call',
    )
    expect(centerMode({ ...detail, case: { ...detail.case, channel: 'phone_outbound' } })).toBe(
      'call',
    )
    expect(centerMode({ ...detail, case: { ...detail.case, channel: 'email' } })).toBe('email')
  })

  it('answers by email a chat whose customer last wrote an email', () => {
    const detail = makeCaseDetail()
    const chat = makeTurn({ sequence: 1 })
    const email = makeEmail(2, 'Hola, les escribo por correo.', 'customer')
    expect(centerMode(detail, [chat, email])).toBe('email')
    expect(centerMode(detail, [email, makeTurn({ sequence: 3 })])).toBe('chat')
  })

  it('shows the call while one is on the line, whatever the channel', () => {
    const detail = { ...makeCaseDetail(), activeCall: makeCall() }
    expect(centerMode(detail)).toBe('call')
    expect(centerMode({ ...detail, activeCall: makeCall({ state: 'ended' }) })).toBe('chat')
  })
})

describe('the call bar', () => {
  it('names every state as Linear does: glyph + word', () => {
    expect(CALL_STATUS.ringing).toMatchObject({ shape: 'ring', label: 'Sonando' })
    expect(CALL_STATUS.in_call).toMatchObject({ shape: 'dot', label: 'En llamada' })
    expect(CALL_STATUS.on_hold).toMatchObject({ shape: 'pause', label: 'En espera' })
    expect(CALL_STATUS.ended).toMatchObject({ shape: 'check', label: 'Llamada terminada' })
  })

  it('says how an ended call ended', () => {
    expect(callStateLabel(makeCall())).toBe('En llamada')
    expect(callStateLabel(makeCall({ state: 'ended', durationSeconds: 372 }))).toBe(
      'Llamada terminada, 6 min 12 s',
    )
    expect(
      callStateLabel(makeCall({ state: 'ended', endReason: 'cancelled', answeredAt: null })),
    ).toBe('Llamada sin respuesta')
    expect(
      callStateLabel(makeCall({ state: 'ended', endReason: 'rejected', answeredAt: null })),
    ).toBe('Llamada rechazada')
    expect(formatCallDuration(45)).toBe('45 s')
    expect(formatCallDuration(3720)).toBe('1 h 02 min')
  })

  it('runs the timer from the call times', () => {
    const now = '2026-03-05T16:04:26Z'
    // Ringing: since it started; talking or on hold: since the answer; ended: its duration.
    expect(callElapsedSeconds(makeCall({ state: 'ringing', answeredAt: null }), now)).toBe(266)
    expect(callElapsedSeconds(makeCall(), now)).toBe(246)
    expect(callElapsedSeconds(makeCall({ state: 'on_hold' }), now)).toBe(246)
    expect(callElapsedSeconds(makeCall({ state: 'ended', durationSeconds: 90 }), now)).toBe(90)
    expect(
      callElapsedSeconds(
        makeCall({
          state: 'ended',
          answeredAt: null,
          durationSeconds: null,
          endedAt: '2026-03-05T16:00:12Z',
        }),
        now,
      ),
    ).toBe(12)
  })

  it('says the direction with the phone arrow', () => {
    expect(callDirectionFact('inbound')).toMatchObject({
      icon: 'phone-incoming',
      text: 'Entrante',
      tooltip: 'Llamada entrante',
    })
    expect(callDirectionFact('outbound')).toMatchObject({
      icon: 'phone-outgoing',
      text: 'Saliente',
    })
  })

  it('offers the right buttons in every state, and none to someone who only reads', () => {
    const none = { answer: false, hold: false, resume: false, mute: false, hangUp: false }
    expect(callControls(makeCall({ state: 'ringing' }), true)).toEqual({
      ...none,
      answer: true,
      hangUp: true,
    })
    // An outbound call is answered by the customer: only "Colgar".
    expect(callControls(makeCall({ state: 'ringing', direction: 'outbound' }), true)).toEqual({
      ...none,
      hangUp: true,
    })
    expect(callControls(makeCall(), true)).toEqual({
      ...none,
      hold: true,
      mute: true,
      hangUp: true,
    })
    expect(callControls(makeCall({ state: 'on_hold' }), true)).toEqual({
      ...none,
      resume: true,
      mute: true,
      hangUp: true,
    })
    expect(callControls(makeCall({ state: 'ended' }), true)).toEqual(none)
    expect(callControls(makeCall(), false)).toEqual(none)
  })

  it('shows the active call, else the last one', () => {
    const last = makeCall({ state: 'ended' })
    expect(barCall({ activeCall: null }, [last])).toBe(last)
    const live = makeCall({ id: 'CALL-2' })
    expect(barCall({ activeCall: live }, [last])).toBe(live)
    expect(barCall({ activeCall: null }, [])).toBeNull()
  })

  it('reads the reason of an outbound call only', () => {
    expect(outboundReason(makeCall({ direction: 'outbound', reason: 'Retomar el cargo' }))).toBe(
      'Retomar el cargo',
    )
    expect(outboundReason(makeCall({ reason: 'x' }))).toBeNull()
    expect(outboundReason(null)).toBeNull()
  })

  it('captions the transcript live while a call is on', () => {
    expect(transcriptCaption(makeCall())).toBe('Transcripción en vivo')
    expect(transcriptCaption(makeCall({ state: 'ended' }))).toBe('Transcripción')
    expect(transcriptCaption(null)).toBe('Transcripción')
  })
})

describe('call caches', () => {
  it('keeps the calls newest first and only takes a newer version', () => {
    const first = makeCall({ id: 'CALL-1', startedAt: '2026-03-05T10:00:00Z', version: 3 })
    const list = upsertCall(undefined, first)
    expect(list.items).toEqual([first])
    const second = makeCall({ id: 'CALL-2', startedAt: '2026-03-05T12:00:00Z' })
    expect(upsertCall(list, second).items.map((call) => call.id)).toEqual(['CALL-2', 'CALL-1'])
    expect(upsertCall(list, { ...first, version: 2, state: 'ringing' })).toBe(list)
    expect(upsertCall(list, { ...first, version: 4, state: 'ended' }).items[0]?.state).toBe('ended')
  })

  it('puts an active call in the detail and takes it out when it ends', () => {
    const detail = makeCaseDetail()
    const ringing = makeCall({ state: 'ringing', version: 1 })
    const withCall = applyCallToDetail(detail, ringing)
    expect(withCall.activeCall).toBe(ringing)
    expect(applyCallToDetail(withCall, { ...ringing, version: 1, state: 'in_call' })).toBe(withCall)
    const ended = applyCallToDetail(withCall, { ...ringing, version: 2, state: 'ended' })
    expect(ended.activeCall).toBeNull()
    expect(applyCallToDetail(detail, makeCall({ caseId: 'CASE-OTHER' }))).toBe(detail)
  })
})

describe('the call transcript', () => {
  it('times each line inside its call and recognises the system lines', () => {
    const call = makeCall()
    expect(callForTime([call], '2026-03-05T16:01:00Z')).toBe(call)
    expect(
      callForTime([makeCall({ endedAt: '2026-03-05T16:00:30Z' })], '2026-03-05T16:01:00Z'),
    ).toBeNull()
    expect(lineOffset(call, '2026-03-05T16:02:41Z')).toBe('02:21')
    expect(callEventKind('Llamada en espera.')).toBe('hold')
    expect(callEventKind('A chamada continua.')).toBe('resume')
    expect(callEventKind('La llamada terminó sin respuesta.')).toBe('end')
  })

  it('turns call lines, system lines and notes into their own items', () => {
    const turns = [
      makeLine(1, 'Buenas tardes, le habla Daniela.', 'analyst', 0),
      makeLine(2, 'Hola, veo un cobro raro.', 'customer', 6),
      makeLine(3, 'Llamada en espera.', 'system', 44),
      makeTurn({
        sequence: 4,
        kind: 'note',
        audience: 'staff',
        authorRole: 'analyst',
        authorId: ME,
        text: 'Revisar con reclamos',
      }),
    ]
    const items = toTranscriptItems(
      { turns, olderCursor: null, contiguousSequence: 4, pending: [] },
      ME,
      { calls: [makeCall()] },
    )
    expect(items.map((item) => [item.variant, item.author, item.time ?? null])).toEqual([
      ['line', 'Tú', '00:00'],
      ['line', 'Cliente', '00:06'],
      ['call-event', null, '00:44'],
      ['note', 'Tú', null],
    ])
    expect(items[0]).toMatchObject({ speaker: 'own', initials: 'DR' })
    expect(items[1]).toMatchObject({ speaker: 'customer', initials: 'MQ' })
    expect(items[2]).toMatchObject({ event: 'hold' })
    expect(items[3]).toMatchObject({ staffOnly: true })
  })
})

describe('email', () => {
  const thread = [
    makeEmail(1, 'Hola, aparece dos veces el mismo cobro.', 'customer'),
    makeEmail(2, 'Hola, Marcela:\n\n¿Lo hizo en la tienda?\n\nSaludos,', 'analyst', 'Re: x'),
    makeEmail(3, 'En la tienda.', 'customer', 'Re: x'),
  ]

  it('threads by the first subject and answers "Re:" once', () => {
    expect(threadSubject(thread)).toBe('Cobro duplicado en mi tarjeta')
    expect(threadSubject([makeTurn()])).toBeNull()
    expect(replySubject('Cobro duplicado')).toBe('Re: Cobro duplicado')
    expect(replySubject('Re: Cobro duplicado')).toBe('Re: Cobro duplicado')
    expect(replySubject('RE: Cobro')).toBe('RE: Cobro')
  })

  it('marks the customer emails nobody answered yet as new', () => {
    expect([...unansweredEmailIds(thread)]).toEqual([thread[2]?.id])
    expect([...unansweredEmailIds(thread.slice(0, 2))]).toEqual([])
    expect([...unansweredEmailIds(thread.slice(0, 1))]).toEqual([thread[0]?.id])
  })

  it('shows emails as items with "Nuevo" and the newest open', () => {
    const items = toTranscriptItems(
      { turns: thread, olderCursor: null, contiguousSequence: 3, pending: [] },
      ME,
    )
    expect(items.map((item) => [item.variant, item.author, item.isNew, item.latest])).toEqual([
      ['email', 'Marcela Quintana Pardo', false, false],
      ['email', 'Tú', false, false],
      ['email', 'Marcela Quintana Pardo', true, true],
    ])
    expect(items[1]).toMatchObject({ initials: 'DR', subject: 'Re: x' })
  })

  it('folds an email to one line and turns the reply into a turn', () => {
    expect(emailSnippet('Hola,\n\n  dos   veces')).toBe('Hola, dos veces')
    const turn = emailToTurn(
      {
        id: 'TRN-9',
        caseId: 'CASE-1',
        sequence: 9,
        direction: 'out',
        subject: 'Re: x',
        body: 'Hola, Marcela:',
        authorRole: 'analyst',
        authorId: ME,
        authorName: 'Daniela Ríos',
        createdAt: '2026-03-05T16:00:00Z',
        clientMessageId: 'k-1',
      },
      'es',
    )
    expect(turn).toMatchObject({
      kind: 'email',
      audience: 'everyone',
      text: 'Hola, Marcela:',
      subject: 'Re: x',
      language: 'es',
    })
  })
})

describe('copy', () => {
  it('validates the reason of "Llamar al cliente"', () => {
    expect(validateCallReason('  ')).toBe('Escribe por qué llamas.')
    expect(validateCallReason('x'.repeat(501))).toBe('El motivo puede tener hasta 500 caracteres.')
    expect(validateCallReason('Retomar el cargo')).toBeNull()
  })

  it('explains call and write failures by code', () => {
    const problem = (code: string, status = 409) => new ApiProblem({ status, code })
    expect(describeCallFailure(problem('call_in_progress'))).toBe(
      'Ya hay una llamada en curso en este caso.',
    )
    expect(describeCallFailure(problem('call_not_active'))).toBe('La llamada ya terminó.')
    expect(describeCallFailure(problem('case_not_assigned', 403))).toMatch(/supervisión/)
    expect(describeWriteFailure(problem('call_not_active'))).toMatch(/no está activa/)
    expect(describeWriteFailure(problem('invalid_value', 422))).toBe(
      'Escribe el asunto del correo.',
    )
    expect(describeCloseFailure(problem('call_in_progress'))).toBe(
      'Cuelga la llamada antes de cerrar el caso.',
    )
  })

  it('says how the closing notice reaches the customer', () => {
    expect(closeNoticeChannel({ channel: 'chat_web' })).toBe('chat')
    expect(closeNoticeChannel({ channel: 'phone_outbound' })).toBe('call')
    expect(closeNoticeChannel({ channel: 'email' })).toBe('email')
  })
})
