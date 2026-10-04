import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { NOW, makeCaseSummary } from '@/test/case-fixtures'
import {
  makeAnalystTurn,
  makeCaseDetail,
  makeClosedDetail,
  makeHistoryItem,
  makeJulianDetail,
  makeTurn,
  seededTurns,
  makeAnsweredEscalation,
  makeEscalation,
} from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import {
  canEscalate,
  describeEscalationFailure,
  escalationCardOf,
  motiveCounter,
  validateMotive,
  addPending,
  applySummary,
  arrivalFacts,
  caseHeaderFacts,
  CLOSED_NOTICE,
  closedFooter,
  closureNote,
  describeCaseLoadFailure,
  describeCloseFailure,
  describeSendFailure,
  emptyTranscript,
  formatWait,
  hasMissingTurns,
  hasSequenceGap,
  historyItemFacts,
  historySheetTitle,
  historyTruncatedNote,
  INITIAL_CLOSE_FORM,
  mergeOlderPage,
  mergeTurns,
  needsDetailRefetch,
  normalizeMessage,
  noteCounter,
  previousCasesLabel,
  footerFacts,
  readTarget,
  removePending,
  shortCaseId,
  toCloseRequest,
  toTranscriptItems,
  transcriptFromPage,
  turnVariant,
  updatePending,
  validateCloseForm,
  QUEUE_LABEL,
  supervisionArrivalLine,
  supervisionFooter,
  caseRows,
  customerFileTriggerLabel,
  customerRows,
  firstResponseFacts,
  previousCasesSectionTitle,
  ratingComment,
  ratingRow,
  conflictCurrentCase,
  describePriorityFailure,
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
  it('maps every turn to its bubble and labels the viewer as "Tú"', () => {
    const turns = [
      ...seededTurns(),
      makeTurn({ sequence: 5, text: 'es un retiro en cajero del 9 de enero' }),
      makeTurn({
        sequence: 6,
        authorRole: 'analyst',
        authorId: 'STF-OTHER',
        authorName: 'Julián Ortega',
      }),
    ]
    const items = toTranscriptItems(mergeTurns(emptyTranscript(), turns), ME)
    expect(items.map((i) => [i.variant, i.author])).toEqual([
      ['customer', 'Marcela Quintana Pardo'],
      ['notice', null],
      ['routing', null],
      ['own', 'Tú'],
      ['customer', 'Marcela Quintana Pardo'],
      ['analyst', 'Julián Ortega'],
    ])
    expect(items[1]?.staffOnly).toBe(false)
    expect(items[2]?.staffOnly).toBe(true)
  })

  it('has no bot variant: a system message is a centred note', () => {
    expect(turnVariant(makeTurn({ authorRole: 'system' }), ME)).toBe('notice')
    expect(turnVariant(makeTurn({ authorRole: 'analyst', authorId: ME }), ME)).toBe('own')
    expect(turnVariant(makeTurn({ authorRole: 'analyst', authorId: 'STF-2' }), ME)).toBe('analyst')
    const item = toTranscriptItems(
      mergeTurns(emptyTranscript(), [
        makeTurn({ sequence: 1, authorRole: 'analyst', authorId: 'STF-2', authorName: null }),
      ]),
      ME,
    )[0]
    expect(item?.author).toBe('Analista')
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

describe('priority failures (slice 8)', () => {
  const conflict = (current: unknown) =>
    new ApiProblem({ status: 409, code: 'version_conflict', extensions: { current } })

  it('says why, and what the priority is now after a conflict', () => {
    const current = { ...makeCaseDetail().case, priority: 'critical' as const }
    expect(describePriorityFailure(conflict(current))).toEqual({
      title: 'No pudimos cambiar la prioridad',
      description: 'Alguien más la cambió: ahora es Crítica.',
    })
    expect(describePriorityFailure(conflict(null)).description).toBe(
      'Alguien más la cambió mientras elegías.',
    )
    expect(
      describePriorityFailure(new ApiProblem({ status: 409, code: 'case_closed' })).description,
    ).toBe('El caso ya está cerrado.')
    expect(
      describePriorityFailure(new ApiProblem({ status: 403, code: 'case_not_assigned' }))
        .description,
    ).toBe('Ya no puedes cambiar la prioridad de este caso.')
    expect(
      describePriorityFailure(new ApiProblem({ status: 0, code: 'network_error' })).description,
    ).toBe('Revisa tu conexión e inténtalo de nuevo.')
    expect(describePriorityFailure(new Error('x')).description).toBe('Inténtalo de nuevo.')
  })

  it('reads the case of a conflict only when it is a case summary', () => {
    const current = makeCaseDetail().case
    expect(conflictCurrentCase(conflict(current))).toEqual(current)
    expect(conflictCurrentCase(conflict({ id: 'STF-1', version: 2 }))).toBeNull()
    expect(conflictCurrentCase(new ApiProblem({ status: 409, code: 'case_closed' }))).toBeNull()
  })
})

describe('header', () => {
  it('builds the header facts: place and channel icon, no dot-joined line', () => {
    expect(caseHeaderFacts(makeCaseDetail())).toEqual([
      {
        key: 'place',
        icon: 'map-pin',
        text: 'Barranquilla, Colombia',
        label: 'Ciudad',
      },
      { key: 'channel', icon: 'message', text: 'Chat web', label: 'Canal', iconOnly: true },
    ])
    const call = makeCaseDetail()
    call.case = { ...call.case, channel: 'phone_inbound' }
    expect(caseHeaderFacts(call)[1]).toMatchObject({
      icon: 'phone-incoming',
      text: 'Llamada entrante',
    })
  })

  it('adds the PT language mark for a Portuguese case (rule 3)', () => {
    const pt = makeCaseDetail()
    pt.case = { ...pt.case, language: 'pt' }
    expect(caseHeaderFacts(pt).at(-1)).toEqual({
      key: 'language',
      icon: 'languages',
      text: '',
      label: 'Idioma',
      languages: ['pt'],
    })
  })

  it('shortens the case number and labels the history button', () => {
    expect(shortCaseId('CASE-00000000000000000000000103')).toBe('CASE-…0103')
    expect(shortCaseId('CASE-1')).toBe('CASE-1')
    expect(previousCasesLabel(2)).toBe('Casos anteriores (2)')
    expect(previousCasesLabel(0)).toBeNull()
  })
})

describe('arrival facts ("Cómo llegó a ti" / "Quién lo atiende")', () => {
  const texts = (facts: { text: string }[] | undefined) => facts?.map((fact) => fact.text)

  it('a language assignment: available + the language, and "Regla 3" for Portuguese', () => {
    const detail = makeCaseDetail()
    expect(arrivalFacts(detail, ME)).toEqual({
      heading: 'Cómo llegó a ti',
      time: '5 mar, 10:46',
      facts: [
        { key: 'available', icon: 'check', text: 'Estabas disponible', tone: 'success' },
        { key: 'language', icon: 'languages', text: 'Hablas', languages: ['es'] },
      ],
    })
    const pt = makeCaseDetail()
    pt.case = { ...pt.case, language: 'pt' }
    expect(arrivalFacts(pt, ME)?.facts[1]).toEqual({
      key: 'language',
      icon: 'languages',
      text: 'Hablas',
      languages: ['pt'],
      tag: 'Regla 3',
    })
  })

  it('a case that waited in the queue', () => {
    const drained = makeCaseDetail({
      assignment: {
        id: 'ASG-2',
        analystId: ME,
        analystName: 'Daniela Ríos',
        reason: 'queue_drained',
        policyRuleId: 'H1',
        assignedAt: '2026-03-05T15:46:10Z',
        queueLabel: 'Cola en portugués',
        waitedSeconds: 360,
        assignedByRole: 'system',
        assignedByName: null,
        previousAnalystId: null,
        previousAnalystName: null,
      },
    })
    expect(texts(arrivalFacts(drained, ME)?.facts)).toEqual([
      'Esperó 6 min',
      'Cola en portugués',
      'Quedaste disponible',
    ])
    expect(arrivalFacts(drained, ME)?.facts.map((fact) => fact.icon)).toEqual([
      'hourglass',
      'inbox',
      'check',
    ])
  })

  it("who attended someone else's closed case, and nothing without an assignment", () => {
    expect(arrivalFacts(makeJulianDetail(), ME)).toEqual({
      heading: 'Quién lo atendió',
      time: expect.any(String),
      facts: [{ key: 'analyst', icon: 'user', text: 'Julián Ortega' }],
    })
    expect(arrivalFacts(makeCaseDetail({ assignment: null }), ME)).toBeNull()
  })

  it("who holds someone else's open case, and the supervisor who gave it", () => {
    const base = makeCaseDetail().assignment!
    const other = { ...base, analystId: 'STF-2', analystName: 'Julián Ortega' }
    expect(arrivalFacts(makeCaseDetail({ assignment: other }), ME)).toMatchObject({
      heading: 'Quién lo atiende',
      facts: [{ icon: 'user', text: 'Julián Ortega' }],
    })
    const manual = {
      ...other,
      reason: 'manual' as const,
      assignedByRole: 'supervisor' as const,
      assignedByName: 'Lucía Herrera',
      previousAnalystId: ME,
      previousAnalystName: 'Daniela Ríos',
    }
    expect(texts(arrivalFacts(makeCaseDetail({ assignment: manual }), ME)?.facts)).toEqual([
      'Julián Ortega',
      'Asignado por Lucía Herrera',
    ])
  })

  it('a manual assignment from the queue and a reassignment (slice 3)', () => {
    const base = makeCaseDetail().assignment!
    const fromQueue = makeCaseDetail({
      assignment: {
        ...base,
        reason: 'manual',
        assignedByRole: 'supervisor',
        assignedByName: 'Lucía Herrera',
        queueLabel: 'Cola en portugués',
        waitedSeconds: 420,
      },
    })
    expect(texts(arrivalFacts(fromQueue, ME)?.facts)).toEqual([
      'Asignado por Lucía Herrera',
      'Esperó 7 min',
    ])
    const reassigned = makeCaseDetail({
      assignment: {
        ...base,
        reason: 'manual',
        assignedByRole: 'supervisor',
        assignedByName: 'Lucía Herrera',
        previousAnalystId: 'STF-2',
        previousAnalystName: 'Julián Ortega',
      },
    })
    expect(arrivalFacts(reassigned, ME)?.facts).toEqual([
      { key: 'by', icon: 'users', text: 'Asignado por Lucía Herrera' },
      { key: 'previous', icon: 'user', text: 'Antes: Julián Ortega' },
    ])
  })

  it('never joins facts with "·" or writes a sentence', () => {
    const facts = arrivalFacts(makeCaseDetail(), ME)!.facts
    for (const fact of facts) {
      expect(fact.text).not.toContain('·')
      expect(fact.text.split(' ').length).toBeLessThanOrEqual(3)
    }
  })

  it('formats waits', () => {
    expect(formatWait(45)).toBe('45 s')
    expect(formatWait(133)).toBe('2 min 13 s')
    expect(formatWait(360)).toBe('6 min')
  })
})

describe('supervision view (slice 3 §8.3)', () => {
  const queued = () => {
    const detail = makeCaseDetail({ assignment: null })
    detail.case = {
      ...detail.case,
      status: 'queued',
      inboxStatus: null,
      assignedAnalystId: null,
      openedAt: '2026-03-05T15:47:00Z',
    }
    return detail
  }

  it('says which queue a queued case waits in, and since when', () => {
    expect(supervisionArrivalLine(queued())).toEqual({
      line: 'Sin asignar desde las 10:47: nadie disponible habla español',
      time: null,
    })
    expect(supervisionFooter(queued())).toEqual([
      'Sin asignar: le llega automáticamente a la primera persona disponible que hable español.',
    ])
  })

  it('says who holds an open case and how it reached her', () => {
    const pt = makeCaseDetail()
    pt.case = { ...pt.case, language: 'pt' }
    expect(supervisionArrivalLine(pt)).toEqual({
      line: 'Lo atiende Daniela Ríos: le llegó al estar disponible y hablar portugués (regla 3)',
      time: '5 mar, 10:46',
    })
    const base = makeCaseDetail().assignment!
    expect(
      supervisionArrivalLine(
        makeCaseDetail({
          assignment: {
            ...base,
            reason: 'queue_drained',
            queueLabel: 'Cola en portugués',
            waitedSeconds: 360,
          },
        }),
      ),
    ).toEqual({
      line: 'Lo atiende Daniela Ríos: le llegó desde la cola en portugués tras 6 min',
      time: '5 mar, 10:46',
    })
    const manual = { ...base, reason: 'manual' as const, assignedByName: 'Lucía Herrera' }
    expect(supervisionArrivalLine(makeCaseDetail({ assignment: manual }))).toEqual({
      line: 'Lo atiende Daniela Ríos: se lo asignó Lucía Herrera',
      time: '5 mar, 10:46',
    })
    expect(
      supervisionArrivalLine(
        makeCaseDetail({ assignment: { ...manual, previousAnalystId: 'STF-2' } }),
      ),
    ).toEqual({ line: 'Lo atiende Daniela Ríos: se lo pasó Lucía Herrera', time: '5 mar, 10:46' })
    expect(supervisionFooter(makeCaseDetail())).toEqual(['Solo lectura: lo atiende Daniela Ríos.'])
  })

  it('shows who attended a closed case and its closure', () => {
    expect(supervisionArrivalLine(makeJulianDetail())).toEqual({
      line: 'Lo atendió Julián Ortega',
      time: null,
    })
    // A closed case: no lines, the closure as separate facts (never " · " joined).
    expect(supervisionFooter(makeJulianDetail())).toBeNull()
    const julian = makeJulianDetail()
    const footer = closedFooter({ closure: julian.closure!, case: julian.case }, 'STF-SUP')
    expect(footer.reason).toBe('resolved')
    expect(footer.facts.map((fact) => [fact.key, fact.text])).toEqual([
      ['closed-at', '13 feb, 10:15'],
      ['closed-by', 'Julián Ortega'],
    ])
  })

  it('keeps the queue labels the backend sends', () => {
    expect(QUEUE_LABEL).toEqual({ es: 'Cola en español', pt: 'Cola en portugués' })
  })
})

describe('closure and the read-only footer', () => {
  it('says when and why the case closed, and who closed it if it was not me', () => {
    const { closure } = makeClosedDetail()
    expect(closedFooter({ closure: closure! }, ME).facts.map((fact) => fact.text)).toEqual([
      '5 mar, 10:58',
    ])
    expect(
      closedFooter(
        { closure: { ...closure!, closedById: 'STF-2', closedByName: 'Julián Ortega' } },
        ME,
      ).facts.map((fact) => fact.text),
    ).toEqual(['5 mar, 10:58', 'Julián Ortega'])
    expect(closureNote(closure!)).toBe('Nota: Se explicó el plazo del reverso (5 días hábiles).')
    expect(closureNote({ note: null })).toBeNull()
    expect(closureNote({ note: '  ' })).toBeNull()
  })

  it('replaces the composer only when the viewer cannot reply, as facts', () => {
    expect(footerFacts(makeCaseDetail(), ME)).toBeNull()
    expect(footerFacts(makeClosedDetail(), ME)).toEqual({
      reason: 'resolved',
      facts: [
        {
          key: 'closed-at',
          icon: 'clock',
          text: '5 mar, 10:58',
          label: 'Cerrado',
          tooltip: 'Cerrado',
        },
      ],
      note: 'Nota: Se explicó el plazo del reverso (5 días hábiles).',
      rating: null,
    })
    expect(footerFacts(makeJulianDetail(), ME)?.facts.map((fact) => fact.text)).toEqual([
      '13 feb, 10:15',
      'Julián Ortega',
    ])
  })

  it("says it is read-only and who has it on someone else's open case", () => {
    const notMine = makeCaseDetail({
      capabilities: {
        canReply: false,
        replyBlockedReason: 'not_assignee',
        canClose: false,
        canAssign: false,
        canChangePriority: false,
        canEscalate: false,
        canCall: false,
        canEmail: false,
        canAddNote: false,
      },
      assignment: {
        ...makeCaseDetail().assignment!,
        analystId: 'STF-2',
        analystName: 'Julián Ortega',
      },
    })
    expect(footerFacts(notMine, ME)).toEqual({
      reason: null,
      facts: [
        { key: 'read-only', icon: 'lock', text: 'Solo lectura' },
        { key: 'owner', icon: 'user', text: 'Lo atiende Julián Ortega' },
      ],
      note: null,
      rating: null,
    })
  })

  it("carries the customer's rating of a closed case (slice 7)", () => {
    const rating = { score: 3, comment: 'Muy amable', ratedAt: '2026-03-05T16:00:00Z' }
    const closed = makeClosedDetail()
    const rated = { ...closed, case: { ...closed.case, rating } }
    expect(footerFacts(rated, ME)?.rating).toEqual(rating)
    expect(ratingComment(rating)).toBe('“Muy amable”')
    expect(ratingComment({ comment: null })).toBeNull()
    expect(ratingComment(null)).toBeNull()
  })
})

describe('rating in the ficha and "Casos anteriores" (slice 7)', () => {
  it('adds "Calificación" to a closed case: the face pill, or "Sin calificar"', () => {
    const closed = makeClosedDetail()
    const unrated = caseRows(closed, NOW).at(-1)
    expect(unrated).toEqual({
      key: 'rating',
      icon: 'smile',
      label: 'Calificación',
      pill: { label: 'Sin calificar', tone: 'closed' },
    })
    const rated = caseRows(
      {
        ...closed,
        case: { ...closed.case, rating: { score: 1, comment: null, ratedAt: NOW.toISOString() } },
      },
      NOW,
    ).at(-1)
    expect(rated?.pill).toEqual({ label: 'Mal', tone: 'danger', icon: 'frown' })
    expect(ratingRow({ score: 4 }).pill).toEqual({
      label: 'Excelente',
      tone: 'success',
      icon: 'laugh',
    })
    expect(ratingRow({ score: 2 }).pill).toEqual({ label: 'Regular', tone: 'warn', icon: 'meh' })
    // An open case has no rating row.
    expect(caseRows(makeCaseDetail(), NOW).map((row) => row.key)).not.toContain('rating')
  })

  it('shows the face alone on a past case the customer rated (slice 8)', () => {
    const facts = historyItemFacts(
      makeHistoryItem({ rating: { score: 4, comment: null, ratedAt: '2026-03-03T16:05:00Z' } }),
    )
    expect(facts.at(-1)).toEqual({
      key: 'rating',
      icon: 'laugh',
      text: 'Calificación: Excelente',
      tone: 'success',
      iconOnly: true,
    })
    expect(historyItemFacts(makeHistoryItem()).map((fact) => fact.key)).not.toContain('rating')
  })
})

describe('case history', () => {
  it('titles the sheet with the first name', () => {
    expect(historySheetTitle('Patricia Lozano Vega')).toBe('Casos anteriores de Patricia')
    expect(historySheetTitle('')).toBe('Casos anteriores')
  })

  it('describes each past case as facts: date and who held it (the status is drawn apart)', () => {
    expect(historyItemFacts(makeHistoryItem()).map((fact) => fact.text)).toEqual([
      '3 mar 2026',
      'Daniela Ríos',
    ])
    expect(
      historyItemFacts(
        makeHistoryItem({ status: 'in_progress', closeReason: null, analystName: null }),
      ).map((fact) => fact.text),
    ).toEqual(['3 mar 2026', 'Sin asignar'])
  })

  it('notes when the list was capped at 20', () => {
    expect(historyTruncatedNote(20, 23)).toBe('Se muestran los 20 más recientes.')
    expect(historyTruncatedNote(2, 2)).toBeNull()
  })
})

describe('composer', () => {
  it('trims and rejects blank or too long messages', () => {
    expect(normalizeMessage('  hola  ')).toBe('hola')
    expect(normalizeMessage('   ')).toBeNull()
    expect(normalizeMessage('a'.repeat(4001))).toBeNull()
  })

  it('maps send failures to copy and says when a retry can help', () => {
    expect(describeSendFailure(new ApiProblem({ status: 409, code: 'case_closed' }))).toEqual({
      message: 'No se envió: el caso ya está cerrado.',
      retryable: false,
    })
    expect(
      describeSendFailure(new ApiProblem({ status: 403, code: 'case_not_assigned' })).retryable,
    ).toBe(false)
    expect(describeSendFailure(ApiProblem.network())).toEqual({
      message: 'No se envió',
      retryable: true,
    })
  })

  it('explains why a case cannot be opened', () => {
    expect(
      describeCaseLoadFailure(new ApiProblem({ status: 403, code: 'case_not_assigned' })).title,
    ).toBe('No tienes acceso a este caso')
    expect(describeCaseLoadFailure(new ApiProblem({ status: 404, code: 'not_found' })).title).toBe(
      'No encontramos este caso',
    )
    expect(describeCaseLoadFailure(ApiProblem.network()).title).toBe(
      'No pudimos cargar la conversación',
    )
  })
})

describe('close dialog', () => {
  it('requires a reason and caps the note at 500 characters', () => {
    expect(validateCloseForm(INITIAL_CLOSE_FORM)).toEqual({ reason: 'Elige un motivo.' })
    expect(validateCloseForm({ reason: 'other', note: '' })).toEqual({})
    expect(validateCloseForm({ reason: 'resolved', note: `  ${'a'.repeat(500)}  ` })).toEqual({})
    expect(validateCloseForm({ reason: 'resolved', note: 'a'.repeat(501) })).toEqual({
      note: 'La nota puede tener hasta 500 caracteres.',
    })
  })

  it('builds the request with a trimmed note, null when blank', () => {
    expect(toCloseRequest({ reason: 'duplicate', note: '  Mismo caso que el 104.  ' })).toEqual({
      reason: 'duplicate',
      note: 'Mismo caso que el 104.',
    })
    expect(toCloseRequest({ reason: 'resolved', note: '   ' })).toEqual({
      reason: 'resolved',
      note: null,
    })
  })

  it('counts the trimmed note', () => {
    expect(noteCounter('')).toBe('0/500')
    expect(noteCounter('  hola ')).toBe('4/500')
  })

  it('pins the closed notice to the backend text, per language', () => {
    expect(CLOSED_NOTICE).toEqual({
      es: 'La conversación terminó. Si necesitas algo más, escríbenos y te atendemos en una nueva conversación.',
      pt: 'A conversa foi encerrada. Se precisar de algo mais, escreva para nós e abrimos uma nova conversa.',
    })
  })

  it('maps close failures', () => {
    expect(describeCloseFailure(new ApiProblem({ status: 409, code: 'case_closed' }))).toBe(
      'Este caso ya estaba cerrado.',
    )
    expect(describeCloseFailure(new ApiProblem({ status: 409, code: 'invalid_transition' }))).toBe(
      'Este caso no se puede cerrar en su estado actual.',
    )
    expect(describeCloseFailure(new ApiProblem({ status: 403, code: 'case_not_assigned' }))).toBe(
      'Ya no puedes cerrarlo: supervisión pasó este caso a otra persona.',
    )
    expect(describeCloseFailure(ApiProblem.network())).toBe(
      'No pudimos cerrar el caso. Inténtalo de nuevo.',
    )
  })
})

describe('"Ficha del cliente" rows (slice 6 §5)', () => {
  const now = new Date('2026-03-05T16:00:00Z')

  it('names the trigger', () => {
    expect(customerFileTriggerLabel('Marcela Quintana Pardo')).toBe(
      'Ver ficha de Marcela Quintana Pardo',
    )
  })

  it('lists who the customer is, one icon row each', () => {
    expect(customerRows(makeCaseDetail())).toEqual([
      { key: 'name', icon: 'user', label: 'Nombre', text: 'Marcela Quintana Pardo' },
      { key: 'place', icon: 'map-pin', label: 'Ciudad', text: 'Barranquilla, Colombia' },
      { key: 'language', icon: 'languages', label: 'Idioma', language: 'es' },
      {
        key: 'id',
        icon: 'id',
        label: 'Id de cliente',
        text: 'CUS-00000000000000000000001001',
        mono: true,
      },
    ])
  })

  it('lists this case: number, channel, priority, opened, status, first response', () => {
    const rows = caseRows(makeCaseDetail(), now)
    expect(rows.map((row) => [row.icon, row.label])).toEqual([
      ['hash', 'Número'],
      ['message', 'Canal'],
      ['flag', 'Prioridad'],
      ['calendar-clock', 'Abierto'],
      ['inbox', 'Estado'],
      ['clock', 'Primera respuesta'],
    ])
    expect(rows.map((row) => row.text)).toEqual([
      'CASE-00000000000000000000000101',
      'Chat web',
      'Media',
      '5 mar, 10:46',
      undefined,
      undefined,
    ])
    expect(rows[4]!.status).toEqual({
      shape: 'pie-75',
      tone: 'warn',
      label: 'Por responder',
      strong: true,
    })
    expect(rows[4]!.pill).toBeUndefined()
    expect(rows[2]!.priority).toBe('medium') // slice 8: the row holds the priority menu
    expect(rows.filter((row) => row.priority).map((row) => row.key)).toEqual(['priority'])
    expect(rows[5]!.facts?.map((fact) => fact.text)).toEqual(['A tiempo', '5 mar, 10:50'])
    for (const row of rows) expect(row.text ?? '').not.toContain('·')
  })

  it('first response: the shared SLA level while pending, the result once answered', () => {
    const base = { status: 'in_progress' as const, slaDueAt: '2026-03-05T16:09:00Z' }
    expect(firstResponseFacts({ ...base, firstResponseAt: null }, now)).toEqual([
      expect.objectContaining({ icon: 'clock', text: '9 min', tone: 'muted' }),
    ])
    expect(
      firstResponseFacts({ ...base, slaDueAt: '2026-03-05T16:04:00Z', firstResponseAt: null }, now),
    ).toEqual([expect.objectContaining({ icon: 'flame', text: '4 min', tone: 'warn' })])
    expect(
      firstResponseFacts({ ...base, slaDueAt: '2026-03-05T15:50:00Z', firstResponseAt: null }, now),
    ).toEqual([
      expect.objectContaining({
        icon: 'flame-filled',
        text: 'Vencido',
        tone: 'danger',
        tooltip: 'Primera respuesta vencida',
      }),
    ])
    expect(
      firstResponseFacts({ ...base, firstResponseAt: '2026-03-05T16:10:00Z' }, now).map((fact) => [
        fact.text,
        fact.tone,
      ]),
    ).toEqual([
      ['Tarde', 'danger'],
      ['5 mar, 11:10', 'muted'],
    ])
    expect(firstResponseFacts({ ...base, status: 'closed', firstResponseAt: null }, now)).toEqual([
      { key: 'result', icon: 'alert', text: 'Sin respuesta', tone: 'muted' },
    ])
  })

  it('titles the section of previous cases', () => {
    expect(previousCasesSectionTitle(2)).toBe('Casos anteriores (2)')
    expect(previousCasesSectionTitle(0)).toBe('Casos anteriores (0)')
  })
})

describe('escalation to supervision (slice 9)', () => {
  const me = analystStaff.id
  const open = makeEscalation()

  it('counts and checks the motive', () => {
    expect(motiveCounter('  Hola  ')).toBe('4/500')
    expect(validateMotive('   ')).toBe('Escribe el motivo.')
    expect(validateMotive('x'.repeat(501))).toBe('El motivo puede tener hasta 500 caracteres.')
    expect(validateMotive('Pide supervisión')).toBeNull()
  })

  it('offers "Escalar a supervisión" only to the assignee of an open, not escalated case', () => {
    const detail = makeCaseDetail()
    expect(
      canEscalate({ ...detail, capabilities: { ...detail.capabilities, canEscalate: true } }),
    ).toBe(true)
    expect(canEscalate(detail)).toBe(false)
    const escalated = { ...detail, case: { ...detail.case, escalated: true } }
    expect(
      canEscalate({ ...escalated, capabilities: { ...detail.capabilities, canEscalate: true } }),
    ).toBe(false)
  })

  it('describes every failure in one line', () => {
    const problem = (code: string, extensions = {}) =>
      new ApiProblem({ status: 409, code: code as never, extensions })
    expect(describeEscalationFailure(problem('escalation_open'), 'escalate')).toBe(
      'Este caso ya está escalado a supervisión.',
    )
    expect(
      describeEscalationFailure(
        problem('escalation_not_open', { currentState: 'answered' }),
        'withdraw',
      ),
    ).toBe('Supervisión ya atendió este escalamiento.')
    expect(
      describeEscalationFailure(
        problem('escalation_not_open', { currentState: 'withdrawn' }),
        'withdraw',
      ),
    ).toBe('Este escalamiento ya se retiró.')
    expect(describeEscalationFailure(problem('case_closed'), 'escalate')).toBe(
      'Este caso ya se cerró.',
    )
    expect(describeEscalationFailure(problem('case_not_assigned'), 'escalate')).toBe(
      'Ya no puedes escalarlo: el caso pasó a otra persona.',
    )
    expect(describeEscalationFailure(problem('validation_error'), 'escalate')).toBe(
      'Escribe el motivo (hasta 500 caracteres).',
    )
    expect(describeEscalationFailure(problem('network_error'), 'escalate')).toBe(
      'Revisa tu conexión e inténtalo de nuevo.',
    )
    expect(describeEscalationFailure(new Error('x'), 'escalate')).toBe(
      'No pudimos escalar el caso. Inténtalo de nuevo.',
    )
  })

  it('shows her open escalation with "Retirar" in the Workspace', () => {
    const card = escalationCardOf(makeCaseDetail({ escalation: open }), me, 'workspace', NOW)
    expect(card).toMatchObject({
      kind: 'open',
      title: 'Escalado a supervisión',
      byName: null,
      since: 'hace 6 min',
      sinceTooltip: 'Escalaste hace 6 min',
      canWithdraw: true,
    })
    // Someone else's case (history access): no card.
    expect(
      escalationCardOf(makeCaseDetail({ escalation: open }), 'STF-OTHER', 'workspace', NOW),
    ).toBeNull()
  })

  it('shows what supervision did until she says "Entendido"', () => {
    const answered = makeAnsweredEscalation()
    expect(
      escalationCardOf(makeCaseDetail({ escalation: answered }), me, 'workspace', NOW),
    ).toMatchObject({
      kind: 'attended',
      title: 'Lucía Herrera respondió',
      note: 'Ya hablé con ella por aquí. Sigue tú con el caso.',
      since: 'hace 1 min',
      sinceTooltip: 'Respondió hace 1 min',
    })
    const taken = makeAnsweredEscalation({
      state: 'taken',
      note: null,
      resolvedByName: 'Felipe Echeverri',
    })
    // The case is no longer hers, she still reads it.
    const notMine = makeCaseDetail({ escalation: taken })
    notMine.case = { ...notMine.case, assignedAnalystId: 'STF-FEL' }
    expect(escalationCardOf(notMine, me, 'workspace', NOW)).toMatchObject({
      title: 'Felipe Echeverri tomó el caso',
      note: null,
    })
    const moved = makeAnsweredEscalation({
      state: 'reassigned',
      note: null,
      reassignedToName: 'Tomás Arango',
    })
    expect(
      escalationCardOf(makeCaseDetail({ escalation: moved }), me, 'workspace', NOW)?.title,
    ).toBe('Lucía Herrera lo reasignó a Tomás Arango')
    const read = makeAnsweredEscalation({ acknowledgedAt: '2026-03-05T15:59:30Z' })
    expect(escalationCardOf(makeCaseDetail({ escalation: read }), me, 'workspace', NOW)).toBeNull()
    expect(
      escalationCardOf(makeCaseDetail({ escalation: answered }), 'STF-OTHER', 'workspace', NOW),
    ).toBeNull()
  })

  it('hides ended, withdrawn and closed-case escalations', () => {
    for (const state of ['withdrawn', 'closed'] as const) {
      const escalation = makeEscalation({ state, resolvedAt: '2026-03-05T15:58:00Z' })
      expect(escalationCardOf(makeCaseDetail({ escalation }), me, 'workspace', NOW)).toBeNull()
    }
    expect(
      escalationCardOf(
        makeClosedDetail({ escalation: makeAnsweredEscalation() }),
        me,
        'workspace',
        NOW,
      ),
    ).toBeNull()
    expect(escalationCardOf(makeCaseDetail(), me, 'workspace', NOW)).toBeNull()
  })

  it('shows supervision the open escalation, read-only', () => {
    expect(
      escalationCardOf(makeCaseDetail({ escalation: open }), 'STF-SUP', 'supervision', NOW),
    ).toMatchObject({
      kind: 'open',
      byName: 'Daniela Ríos',
      sinceTooltip: 'Escaló hace 6 min',
      canWithdraw: false,
    })
    expect(
      escalationCardOf(
        makeCaseDetail({ escalation: makeAnsweredEscalation() }),
        me,
        'supervision',
        NOW,
      ),
    ).toBeNull()
  })
})
