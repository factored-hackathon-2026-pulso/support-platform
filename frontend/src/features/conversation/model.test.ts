import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { makeCaseSummary } from '@/test/case-fixtures'
import {
  makeAnalystTurn,
  makeCaseDetail,
  makeTurn,
  seededTurns,
  stop,
} from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import {
  addPending,
  applySummary,
  callBarState,
  callOffset,
  caseHeaderMeta,
  conversationLayout,
  describeCaseLoadFailure,
  describeCloseFailure,
  describeSendFailure,
  emailSnippet,
  emptyTranscript,
  formatWait,
  hasMissingTurns,
  hasSequenceGap,
  INITIAL_CLOSE_FORM,
  inputsSentence,
  joinSpanish,
  mergeOlderPage,
  mergeTurns,
  needsDetailRefetch,
  normalizeMessage,
  readTarget,
  removePending,
  RESOLUTION_OPTIONS,
  routeLine,
  routeSteps,
  toCloseRequest,
  toTranscriptItems,
  transcriptFromPage,
  turnVariant,
  updatePending,
  validateCloseForm,
} from './model'
import type { PendingMessage, TranscriptCache } from './types'

const ME = analystStaff.id

function pending(clientMessageId: string, text = 'Hola, Marcela'): PendingMessage {
  return {
    clientMessageId,
    text,
    createdAt: '2026-03-05T16:00:00Z',
    status: 'sending',
    error: null,
    retryable: false,
  }
}

function cacheWith(turns = seededTurns(), extra: Partial<TranscriptCache> = {}): TranscriptCache {
  return mergeTurns({ ...emptyTranscript(), olderCursor: 'c-1', ...extra }, turns)
}

describe('transcript merge', () => {
  it('orders by sequence whatever the arrival order', () => {
    const [a, b, c] = seededTurns()
    const cache = mergeTurns(emptyTranscript(), [c!, a!, b!])
    expect(cache.turns.map((t) => t.sequence)).toEqual([1, 2, 3])
    expect(cache.contiguousSequence).toBe(3)
  })

  it('dedupes by id (POST response, realtime echo and refetch carry the same turn)', () => {
    const cache = cacheWith()
    const again = mergeTurns(cache, [seededTurns()[2]!, seededTurns()[2]!])
    expect(again).toBe(cache)
    expect(
      mergeTurns(emptyTranscript(), [makeTurn({ sequence: 9 }), makeTurn({ sequence: 9 })]).turns,
    ).toHaveLength(1)
  })

  it('reconciles a pending message with its confirmed turn by clientMessageId', () => {
    const cache = addPending(cacheWith(), pending('cm-1'))
    const confirmed = mergeTurns(cache, [makeAnalystTurn(5, 'Hola, Marcela', 'cm-1')])
    expect(confirmed.pending).toEqual([])
    expect(confirmed.turns.at(-1)?.clientMessageId).toBe('cm-1')
    // The echo arriving after the POST response changes nothing.
    expect(mergeTurns(confirmed, [makeAnalystTurn(5, 'Hola, Marcela', 'cm-1')])).toBe(confirmed)
  })

  it('keeps older pages and pending messages when the latest page is merged again', () => {
    const cache = addPending(cacheWith(), pending('cm-2'))
    const next = transcriptFromPage(
      {
        items: [...seededTurns().slice(2), makeTurn({ sequence: 5 })],
        olderCursor: 'c-2',
        lastSequence: 5,
      },
      cache,
    )
    expect(next.turns.map((t) => t.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(next.pending).toHaveLength(1)
    expect(next.olderCursor).toBe('c-1')
  })

  it('takes the cursor of the first page and of every older page', () => {
    const first = transcriptFromPage({
      items: seededTurns().slice(2),
      olderCursor: 'c-9',
      lastSequence: 4,
    })
    expect(first.olderCursor).toBe('c-9')
    const older = mergeOlderPage(first, {
      items: seededTurns().slice(0, 2),
      olderCursor: null,
      lastSequence: 4,
    })
    expect(older.turns.map((t) => t.sequence)).toEqual([1, 2, 3, 4])
    expect(older.olderCursor).toBeNull()
  })

  it('detects a sequence gap only for unseen turns past contiguousSequence + 1', () => {
    const cache = cacheWith()
    expect(hasSequenceGap(cache, makeTurn({ sequence: 5 }))).toBe(false)
    expect(hasSequenceGap(cache, makeTurn({ sequence: 7 }))).toBe(true)
    expect(hasSequenceGap(cache, seededTurns()[3]!)).toBe(false)
  })

  it('keeps a hole visible when our own REST turn arrives after a missed turn', () => {
    // Socket down: the customer wrote seq 5 (never received), our reply came back as 6.
    const cache = mergeTurns(cacheWith(), [makeAnalystTurn(6, 'Ya lo reviso', 'cm-6')])
    expect(cache.turns.map((t) => t.sequence)).toEqual([1, 2, 3, 4, 6])
    expect(cache.contiguousSequence).toBe(4)
    expect(hasMissingTurns(cache)).toBe(true)
    // The next live turn is a gap, so the cache catches up from the hole.
    expect(hasSequenceGap(cache, makeTurn({ sequence: 7 }))).toBe(true)
    // The catch-up (afterSequence=4) fills the hole and the mark moves to the end.
    const filled = mergeTurns(cache, [makeTurn({ sequence: 5 }), makeAnalystTurn(6, 'x', 'cm-6')])
    expect(filled.turns.map((t) => t.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(filled.contiguousSequence).toBe(6)
    expect(hasMissingTurns(filled)).toBe(false)
  })

  it('starts the gap-free mark at the first page, older history is not a hole', () => {
    const page = transcriptFromPage({
      items: [makeTurn({ sequence: 51 }), makeTurn({ sequence: 52 })],
      olderCursor: 'c-51',
      lastSequence: 52,
    })
    expect(page.contiguousSequence).toBe(52)
    expect(hasMissingTurns(page)).toBe(false)
    expect(transcriptFromPage({ items: [], olderCursor: null, lastSequence: 0 })).toMatchObject({
      contiguousSequence: 0,
      turns: [],
    })
  })

  it('updates and removes pending messages', () => {
    const cache = addPending(emptyTranscript(), pending('cm-3'))
    const failed = updatePending(cache, 'cm-3', {
      status: 'failed',
      error: 'No se envió',
      retryable: true,
    })
    expect(failed.pending[0]).toMatchObject({ status: 'failed', retryable: true })
    expect(updatePending(cache, 'other', { status: 'failed' })).toBe(cache)
    expect(removePending(failed, 'cm-3').pending).toEqual([])
    // Re-adding the same id (retry) replaces it instead of duplicating.
    expect(addPending(failed, pending('cm-3')).pending).toHaveLength(1)
  })
})

describe('transcript items', () => {
  it('maps every turn to its bubble and labels the analyst as "Tú"', () => {
    const turns = [
      ...seededTurns(),
      makeTurn({
        sequence: 5,
        kind: 'notice',
        authorRole: 'system',
        authorId: null,
        authorName: null,
        text: 'Recibimos tu mensaje.',
      }),
      makeAnalystTurn(6, 'Hola, Marcela', 'cm-1'),
      makeTurn({
        sequence: 7,
        authorRole: 'analyst',
        authorId: 'STF-OTHER',
        authorName: 'Julián Ortega',
      }),
    ]
    const items = toTranscriptItems(mergeTurns(emptyTranscript(), turns), ME)
    expect(items.map((i) => [i.variant, i.author])).toEqual([
      ['customer', 'Marcela Quintana Pardo'],
      ['bot', 'Árbol de decisión'],
      ['customer', 'Marcela Quintana Pardo'],
      ['routing', null],
      ['notice', null],
      ['own', 'Tú'],
      ['analyst', 'Julián Ortega'],
    ])
    expect(items[3]?.staffOnly).toBe(true)
  })

  it('shows pending messages last, sending or failed', () => {
    const cache = updatePending(
      addPending(addPending(cacheWith(), pending('cm-a', 'uno')), pending('cm-b', 'dos')),
      'cm-a',
      { status: 'failed', error: 'No se envió', retryable: true },
    )
    const items = toTranscriptItems(cache, ME)
    expect(items.slice(-2).map((i) => [i.text, i.delivery, i.retryable])).toEqual([
      ['uno', 'failed', true],
      ['dos', 'sending', false],
    ])
  })

  it('keeps the same key from "Enviando…" to sent, so the bubble is not remounted', () => {
    const sending = toTranscriptItems(addPending(cacheWith(), pending('cm-k', 'hola')), ME)
    const sent = toTranscriptItems(
      mergeTurns(addPending(cacheWith(), pending('cm-k', 'hola')), [
        makeAnalystTurn(5, 'hola', 'cm-k'),
      ]),
      ME,
    )
    expect(sending.at(-1)?.key).toBe('cm-k')
    expect(sent.at(-1)).toMatchObject({ key: 'cm-k', delivery: 'sent' })
    // Turns without a clientMessageId keep their id.
    expect(sent[0]?.key).toBe(seededTurns()[0]?.id)
  })

  it('falls back to role names for bots without a display name', () => {
    expect(turnVariant(makeTurn({ authorRole: 'ai_agent' }), ME)).toBe('bot')
    const item = toTranscriptItems(
      mergeTurns(emptyTranscript(), [
        makeTurn({ sequence: 1, authorRole: 'judge', authorName: null }),
      ]),
      ME,
    )[0]
    expect(item?.author).toBe('Juez de entrada')
  })
})

describe('case summary updates', () => {
  it('applies only newer versions', () => {
    const detail = makeCaseDetail()
    const older = { ...detail.case, version: detail.case.version - 1, unreadCount: 9 }
    expect(applySummary(detail, older)).toBe(detail)
    const newer = { ...detail.case, version: detail.case.version + 1, unreadCount: 2 }
    expect(applySummary(detail, newer).case.unreadCount).toBe(2)
    expect(applySummary(detail, { ...newer, id: 'CASE-OTHER' })).toBe(detail)
  })

  it('asks for a fresh detail when the status or the assignee changes', () => {
    const detail = makeCaseDetail()
    const v = detail.case.version + 1
    expect(needsDetailRefetch(detail, { ...detail.case, version: v })).toBe(false)
    expect(needsDetailRefetch(detail, { ...detail.case, version: v, status: 'closed' })).toBe(true)
    expect(needsDetailRefetch(detail, { ...detail.case, status: 'closed' })).toBe(false)
  })

  it('marks read only for the assignee with a new case or unread messages', () => {
    const base = makeCaseSummary({ assignedAnalystId: ME, lastSequence: 6, unreadCount: 0 })
    expect(readTarget(base, ME)).toBeNull()
    expect(readTarget({ ...base, unreadCount: 3 }, ME)).toBe(6)
    expect(readTarget({ ...base, status: 'assigned' }, ME)).toBe(6)
    expect(readTarget({ ...base, unreadCount: 3 }, 'STF-SUP0000001')).toBeNull()
    expect(readTarget({ ...base, unreadCount: 3, status: 'closed' }, ME)).toBeNull()
  })
})

describe('header and layouts', () => {
  it('builds the header meta line of the canvas', () => {
    expect(caseHeaderMeta(makeCaseDetail())).toBe(
      'Colombia · Barranquilla · chat web · prioridad media',
    )
    const pt = makeCaseDetail()
    pt.case = { ...pt.case, language: 'pt' }
    pt.customer = { ...pt.customer, city: 'Medellín' }
    expect(caseHeaderMeta(pt)).toBe('Colombia · Medellín · chat web · en portugués')
    const regulator = makeCaseDetail({
      routing: { stops: [stop({ kind: 'entry', label: 'CONDUSEF' })], inputsUsed: [] },
    })
    regulator.case = { ...regulator.case, origin: 'regulator', priority: 'low', channel: 'phone' }
    regulator.customer = { ...regulator.customer, country: 'MX' }
    expect(caseHeaderMeta(regulator)).toBe('México · reclamo por la CONDUSEF · prioridad baja')
  })

  it('picks the layout per channel', () => {
    expect(conversationLayout('app_chat')).toBe('chat')
    expect(conversationLayout('web_chat')).toBe('chat')
    expect(conversationLayout('phone')).toBe('call')
    expect(conversationLayout('email')).toBe('email')
  })

  it('shows the call state, timer and how the call came in', () => {
    const live = makeCaseDetail({
      channelIdentity: { kind: 'caller_number', verified: true },
      routing: { stops: [stop({ kind: 'entry', label: 'IVR' })], inputsUsed: [] },
    })
    live.case = { ...live.case, status: 'in_call', liveSince: '2026-03-05T15:55:54Z' }
    expect(callBarState(live, Date.parse('2026-03-05T16:00:00Z'))).toEqual({
      state: 'En llamada',
      tone: 'success',
      timer: '04:06',
      kind: 'Entrante · el IVR verificó su identidad',
    })
    const outbound = makeCaseDetail({
      channelIdentity: { kind: 'outbound_call', verified: false },
      routing: { stops: [stop({ kind: 'entry', label: 'CONDUSEF' })], inputsUsed: [] },
    })
    outbound.case = { ...outbound.case, status: 'to_call', origin: 'regulator' }
    expect(callBarState(outbound, 0)).toMatchObject({
      state: 'Por llamar',
      timer: null,
      kind: 'Saliente · reclamo por la CONDUSEF',
    })
    expect(callOffset('2026-03-05T15:58:01Z', '2026-03-05T15:55:54Z')).toBe('02:07')
  })

  it('takes the first meaningful line of an e-mail', () => {
    expect(emailSnippet('Hola:\n\nBueno, adelante. Veamos si pueden resolverlo.\n\nSaludos')).toBe(
      'Bueno, adelante. Veamos si pueden resolverlo.',
    )
    expect(emailSnippet('Buenas tardes:')).toBe('Buenas tardes:')
  })
})

describe('composer', () => {
  it('trims and rejects blank or too long messages', () => {
    expect(normalizeMessage('  hola  \n')).toBe('hola')
    expect(normalizeMessage('   ')).toBeNull()
    expect(normalizeMessage('a'.repeat(4001))).toBeNull()
    expect(normalizeMessage('línea 1\nlínea 2')).toBe('línea 1\nlínea 2')
  })

  it('maps send failures to copy and says when a retry can help', () => {
    expect(describeSendFailure(ApiProblem.network())).toEqual({
      message: 'No se envió',
      retryable: true,
    })
    expect(
      describeSendFailure(new ApiProblem({ status: 503, code: 'unexpected_error' })).retryable,
    ).toBe(true)
    for (const code of [
      'case_closed',
      'channel_not_supported',
      'case_not_assigned',
      'idempotency_conflict',
    ]) {
      const failure = describeSendFailure(new ApiProblem({ status: 409, code }))
      expect(failure.retryable).toBe(false)
      expect(failure.message).toMatch(/^No se envió: /)
    }
  })

  it('explains why a case cannot be opened', () => {
    expect(
      describeCaseLoadFailure(new ApiProblem({ status: 403, code: 'case_not_assigned' })).title,
    ).toBe('Este caso no está asignado a ti')
    expect(describeCaseLoadFailure(new ApiProblem({ status: 404, code: 'not_found' })).title).toBe(
      'No encontramos este caso',
    )
    expect(describeCaseLoadFailure(ApiProblem.network()).title).toBe(
      'No pudimos cargar la conversación',
    )
  })
})

describe('Cómo llegó a ti', () => {
  it('draws the null chain as "Juez → árbol → agente de IA → tú"', () => {
    const detail = makeCaseDetail()
    expect(routeLine(detail.routing.stops, ME)).toBe('Juez → árbol → agente de IA → tú')
    const steps = routeSteps(detail, ME)
    expect(steps.map((s) => s.title)).toEqual([
      'Juez de entrada',
      'Árbol de decisión',
      'Agente de IA',
      'Tú',
    ])
    expect(steps[0]?.lines).toEqual(['Todavía no hay uno conectado: pasó el caso sin atenderlo.'])
    expect(steps[3]?.lines[0]).toBe('Te llegó porque estás disponible y hablas español.')
    expect(steps[3]?.lines[1]).toBe('Desde el 5 mar, 10:58.')
    expect(steps.map((s) => s.current)).toEqual([false, false, false, true])
    expect(inputsSentence(detail.routing.inputsUsed)).toBe(
      'Ningún nivel automático leyó datos del cliente.',
    )
  })

  it('adds rule 3 for Portuguese and the queue wait', () => {
    const detail = makeCaseDetail()
    detail.case = { ...detail.case, language: 'pt' }
    detail.routing = {
      stops: [
        stop({
          kind: 'tier',
          tier: 'judge',
          outcome: 'abstained',
          reasonCode: 'component_not_connected',
        }),
        stop({ kind: 'queue', label: 'Cola de disputas en portugués', waitedSeconds: 133 }),
        stop({
          kind: 'assignee',
          label: 'Daniela Ríos',
          staffId: ME,
          reasonCode: 'language_least_loaded',
          policyRuleId: 'H1',
        }),
      ],
      inputsUsed: [],
    }
    const steps = routeSteps(detail, ME)
    expect(routeLine(detail.routing.stops, ME)).toBe('Juez → cola de disputas en portugués → tú')
    expect(steps[1]?.lines).toEqual(['Esperó 2 min 13 s.'])
    expect(steps[2]?.lines[0]).toBe(
      'Te llegó porque estás disponible y hablas portugués (regla 3).',
    )
  })

  it('explains the assignment with the reason and rule the server recorded', () => {
    const lineFor = (overrides: Parameters<typeof stop>[0]) => {
      const detail = makeCaseDetail()
      detail.routing = {
        stops: [stop({ kind: 'assignee', label: 'Daniela Ríos', staffId: ME, ...overrides })],
        inputsUsed: [],
      }
      return routeSteps(detail, ME)[0]?.lines[0]
    }
    expect(lineFor({ reasonCode: 'queue_drained' })).toBe(
      'Te llegó porque estás disponible y hablas español.',
    )
    // CONDUSEF (seed 106): an outbound follow-up from the regulatory queue, rule 11.
    expect(lineFor({ reasonCode: 'outbound_followup', policyRuleId: 'A2' })).toBe(
      'Te lo asignaron para llamar al cliente: seguimiento saliente (regla 11).',
    )
    expect(lineFor({ reasonCode: 'outbound_followup' })).toBe(
      'Te lo asignaron para llamar al cliente: seguimiento saliente.',
    )
    // No rule recorded: no rule claimed, even for a Portuguese case.
    expect(lineFor({ reasonCode: 'something_new' })).toBe('Te lo asignaron.')
    expect(lineFor({ reasonCode: null, policyRuleId: 'H1' })).toBe('Te lo asignaron (regla 3).')
    expect(lineFor({ reasonCode: 'outbound_followup', summary: 'Lo asignó para llamar.' })).toBe(
      'Lo asignó para llamar.',
    )
  })

  it('keeps acronyms and seeded summaries, and names who read what', () => {
    const detail = makeCaseDetail({
      routing: {
        stops: [
          stop({
            kind: 'entry',
            label: 'IVR',
            summary: 'Verificó su identidad con documento y clave.',
          }),
          stop({ kind: 'queue', label: 'Cola de disputas', waitedSeconds: 133 }),
          stop({
            kind: 'tier',
            tier: 'ai_agent',
            label: 'Agente de disputas',
            outcome: 'handed_off',
          }),
          stop({ kind: 'assignee', label: 'Julián Ortega', staffId: 'STF-OTHER' }),
        ],
        inputsUsed: ['customers', 'transactions', 'interactions'],
      },
    })
    expect(routeLine(detail.routing.stops, ME)).toBe(
      'IVR → cola de disputas → agente de disputas → Julián',
    )
    const steps = routeSteps(detail, ME)
    expect(steps[0]?.lines).toEqual(['Verificó su identidad con documento y clave.'])
    expect(steps[2]?.lines).toEqual(['Atendió una parte y pasó el caso.'])
    expect(steps[3]?.lines[0]).toBe('Asignado a Julián Ortega.')
    expect(inputsSentence(detail.routing.inputsUsed)).toBe(
      'Usaron su ficha, sus movimientos y sus contactos anteriores.',
    )
    expect(routeLine([], ME)).toBe('Sin recorrido registrado')
  })

  it('formats waits and Spanish lists', () => {
    expect(formatWait(45)).toBe('45 s')
    expect(formatWait(120)).toBe('2 min')
    expect(formatWait(3900)).toBe('1 h 05 min')
    expect(joinSpanish(['a'])).toBe('a')
    expect(joinSpanish(['a', 'b'])).toBe('a y b')
  })
})

describe('close dialog', () => {
  it('requires the result and builds the request', () => {
    expect(validateCloseForm(INITIAL_CLOSE_FORM)).toHaveProperty('resolved')
    const form = { ...INITIAL_CLOSE_FORM, resolved: false }
    expect(validateCloseForm(form)).toEqual({})
    expect(toCloseRequest(form)).toEqual({
      resolved: false,
      contactReason: 'Transaccional',
      resolutionCode: null,
      followUp: 'tomorrow',
      sendCsatSurvey: true,
    })
    expect(toCloseRequest({ ...form, resolutionCode: 'explained' }).resolutionCode).toBe(
      'explained',
    )
  })

  it('offers the five canvas phrases, one per resolution code', () => {
    expect(new Set(RESOLUTION_OPTIONS.map((o) => o.value)).size).toBe(5)
  })

  it('maps close failures', () => {
    expect(describeCloseFailure(new ApiProblem({ status: 409, code: 'case_closed' }))).toBe(
      'Este caso ya estaba cerrado.',
    )
    expect(describeCloseFailure(ApiProblem.network())).toBe(
      'No pudimos cerrar el caso. Inténtalo de nuevo.',
    )
  })
})
