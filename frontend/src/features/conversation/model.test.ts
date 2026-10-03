import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { makeCaseSummary } from '@/test/case-fixtures'
import {
  makeAnalystTurn,
  makeCaseDetail,
  makeClosedDetail,
  makeHistoryItem,
  makeJulianDetail,
  makeTurn,
  seededTurns,
} from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import {
  addPending,
  applySummary,
  arrivalNote,
  caseHeaderMeta,
  CLOSED_NOTICE,
  closureLine,
  closureNote,
  describeCaseLoadFailure,
  describeCloseFailure,
  describeSendFailure,
  emptyTranscript,
  formatWait,
  hasMissingTurns,
  hasSequenceGap,
  historyItemLine,
  historySheetTitle,
  historyTruncatedNote,
  INITIAL_CLOSE_FORM,
  mergeOlderPage,
  mergeTurns,
  needsDetailRefetch,
  normalizeMessage,
  noteCounter,
  previousCasesLabel,
  readOnlyFooter,
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

describe('header', () => {
  it('builds the meta line: country, city, channel and priority', () => {
    expect(caseHeaderMeta(makeCaseDetail())).toBe(
      'Colombia · Barranquilla · chat web · prioridad media',
    )
    const app = makeCaseDetail()
    app.case = { ...app.case, channel: 'app_chat', priority: 'high' }
    expect(caseHeaderMeta(app)).toBe('Colombia · Barranquilla · chat en la app · prioridad alta')
  })

  it('says "en portugués" instead of the priority for a Portuguese case (rule 3)', () => {
    const pt = makeCaseDetail()
    pt.case = { ...pt.case, language: 'pt' }
    expect(caseHeaderMeta(pt)).toBe('Colombia · Barranquilla · chat web · en portugués')
  })

  it('shortens the case number and labels the history button', () => {
    expect(shortCaseId('CASE-00000000000000000000000103')).toBe('CASE-…0103')
    expect(shortCaseId('CASE-1')).toBe('CASE-1')
    expect(previousCasesLabel(2)).toBe('Casos anteriores (2)')
    expect(previousCasesLabel(0)).toBeNull()
  })
})

describe('arrival note (Cómo llegó a ti / Quién lo atiende)', () => {
  it('explains a language assignment, with rule 3 for Portuguese', () => {
    const detail = makeCaseDetail()
    expect(arrivalNote(detail, ME)).toEqual({
      heading: 'Cómo llegó a ti',
      line: 'Te llegó porque estás disponible y hablas español · 5 mar, 10:46',
    })
    const pt = makeCaseDetail()
    pt.case = { ...pt.case, language: 'pt' }
    expect(arrivalNote(pt, ME)?.line).toBe(
      'Te llegó porque estás disponible y hablas portugués (regla 3) · 5 mar, 10:46',
    )
  })

  it('explains a case that waited in the queue', () => {
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
    expect(arrivalNote(drained, ME)?.line).toBe(
      'Esperó 6 min en la cola en portugués y te llegó cuando quedaste disponible · 5 mar, 10:46',
    )
  })

  it("names who attended someone else's closed case, and says nothing without an assignment", () => {
    expect(arrivalNote(makeJulianDetail(), ME)).toEqual({
      heading: 'Quién lo atendió',
      line: 'Lo atendió Julián Ortega',
    })
    expect(arrivalNote(makeCaseDetail({ assignment: null }), ME)).toBeNull()
  })

  it('says who holds an open case that supervision took from the viewer, in the present', () => {
    const base = makeCaseDetail().assignment!
    const takenFromMe = makeCaseDetail({
      assignment: {
        ...base,
        analystId: 'STF-2',
        analystName: 'Julián Ortega',
        reason: 'manual',
        assignedByRole: 'supervisor',
        assignedByName: 'Lucía Herrera',
        previousAnalystId: ME,
        previousAnalystName: 'Daniela Ríos',
      },
    })
    expect(arrivalNote(takenFromMe, ME)).toEqual({
      heading: 'Quién lo atiende',
      line: 'Lucía Herrera pasó este caso a Julián Ortega · 5 mar, 10:46',
    })
  })

  it("says who holds someone else's open case, and how a supervisor gave it", () => {
    const base = makeCaseDetail().assignment!
    const other = { ...base, analystId: 'STF-2', analystName: 'Julián Ortega' }
    expect(arrivalNote(makeCaseDetail({ assignment: other }), ME)).toEqual({
      heading: 'Quién lo atiende',
      line: 'Lo atiende Julián Ortega',
    })
    const manual = {
      ...other,
      reason: 'manual' as const,
      assignedByRole: 'supervisor' as const,
      assignedByName: 'Lucía Herrera',
    }
    expect(arrivalNote(makeCaseDetail({ assignment: manual }), ME)?.line).toBe(
      'Lo atiende Julián Ortega · Lucía Herrera se lo asignó el 5 mar, 10:46',
    )
    const passed = { ...manual, previousAnalystId: 'STF-9', previousAnalystName: 'Paula Medina' }
    expect(arrivalNote(makeCaseDetail({ assignment: passed }), ME)?.line).toBe(
      'Lo atiende Julián Ortega · Lucía Herrera se lo pasó el 5 mar, 10:46',
    )
  })

  it('explains a manual assignment from the queue and a reassignment (slice 3)', () => {
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
    expect(arrivalNote(fromQueue, ME)?.line).toBe(
      'Lucía Herrera te asignó este caso después de 7 min en la cola en portugués · 5 mar, 10:46',
    )
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
    expect(arrivalNote(reassigned, ME)?.line).toBe(
      'Lucía Herrera te pasó este caso; antes lo atendía Julián Ortega · 5 mar, 10:46',
    )
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
    expect(supervisionArrivalLine(queued())).toBe(
      'Espera en la cola en español desde las 10:47: nadie disponible habla español',
    )
    expect(supervisionFooter(queued(), ME)).toEqual([
      'Vista de supervisión · El caso espera en la cola en español. Asígnalo para que alguien le responda.',
    ])
  })

  it('says who holds an open case and how it reached her', () => {
    const pt = makeCaseDetail()
    pt.case = { ...pt.case, language: 'pt' }
    expect(supervisionArrivalLine(pt)).toBe(
      'Lo atiende Daniela Ríos: le llegó al estar disponible y hablar portugués (regla 3) · 5 mar, 10:46',
    )
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
    ).toBe('Lo atiende Daniela Ríos: le llegó desde la cola en portugués tras 6 min · 5 mar, 10:46')
    const manual = { ...base, reason: 'manual' as const, assignedByName: 'Lucía Herrera' }
    expect(supervisionArrivalLine(makeCaseDetail({ assignment: manual }))).toBe(
      'Lo atiende Daniela Ríos: se lo asignó Lucía Herrera · 5 mar, 10:46',
    )
    expect(
      supervisionArrivalLine(
        makeCaseDetail({ assignment: { ...manual, previousAnalystId: 'STF-2' } }),
      ),
    ).toBe('Lo atiende Daniela Ríos: se lo pasó Lucía Herrera · 5 mar, 10:46')
    expect(supervisionFooter(makeCaseDetail(), ME)).toEqual([
      'Vista de supervisión · Solo lectura. Lo atiende Daniela Ríos.',
    ])
  })

  it('shows who attended a closed case and its closure', () => {
    expect(supervisionArrivalLine(makeJulianDetail())).toBe('Lo atendió Julián Ortega')
    expect(supervisionFooter(makeJulianDetail(), 'STF-SUP')).toEqual([
      'Caso cerrado el 13 feb, 10:15 por Julián Ortega · Resuelto',
    ])
  })

  it('keeps the queue labels the backend sends', () => {
    expect(QUEUE_LABEL).toEqual({ es: 'Cola en español', pt: 'Cola en portugués' })
  })
})

describe('closure and the read-only footer', () => {
  it('says when and why the case closed, and who closed it if it was not me', () => {
    const { closure } = makeClosedDetail()
    expect(closureLine(closure!, ME)).toBe('Caso cerrado el 5 mar, 10:58 · Resuelto')
    expect(
      closureLine({ ...closure!, closedById: 'STF-2', closedByName: 'Julián Ortega' }, ME),
    ).toBe('Caso cerrado el 5 mar, 10:58 por Julián Ortega · Resuelto')
    expect(closureNote(closure!)).toBe('Nota: Se explicó el plazo del reverso (5 días hábiles).')
    expect(closureNote({ note: null })).toBeNull()
    expect(closureNote({ note: '  ' })).toBeNull()
  })

  it('replaces the composer only when the viewer cannot reply', () => {
    expect(readOnlyFooter(makeCaseDetail(), ME)).toBeNull()
    expect(readOnlyFooter(makeClosedDetail(), ME)).toEqual([
      'Caso cerrado el 5 mar, 10:58 · Resuelto',
      'Nota: Se explicó el plazo del reverso (5 días hábiles).',
    ])
    expect(readOnlyFooter(makeJulianDetail(), ME)).toEqual([
      'Caso cerrado el 13 feb, 10:15 por Julián Ortega · Resuelto',
    ])
  })

  it('says whose case it is on an open case of someone else', () => {
    const notMine = makeCaseDetail({
      capabilities: {
        canReply: false,
        replyBlockedReason: 'not_assignee',
        canClose: false,
        canAssign: false,
      },
      assignment: {
        ...makeCaseDetail().assignment!,
        analystId: 'STF-2',
        analystName: 'Julián Ortega',
      },
    })
    expect(readOnlyFooter(notMine, ME)).toEqual(['Solo lectura: este caso es de Julián Ortega.'])
  })
})

describe('case history', () => {
  it('titles the sheet with the first name', () => {
    expect(historySheetTitle('Patricia Lozano Vega')).toBe('Casos anteriores de Patricia')
    expect(historySheetTitle('')).toBe('Casos anteriores')
  })

  it('describes each past case: date, reason or "Abierto", and who held it', () => {
    expect(historyItemLine(makeHistoryItem())).toBe('3 mar 2026 · Resuelto · Daniela Ríos')
    expect(
      historyItemLine(
        makeHistoryItem({ status: 'in_progress', closeReason: null, analystName: null }),
      ),
    ).toBe('3 mar 2026 · Abierto · Sin asignar')
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
