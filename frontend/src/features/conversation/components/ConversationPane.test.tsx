import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { makeCaseSummary } from '@/test/case-fixtures'
import {
  CASE_ID,
  envelope,
  julianTurns,
  makeAnalystTurn,
  makeCaseDetail,
  makeClosedDetail,
  makeJulianDetail,
  makeTurn,
  seededTurns,
} from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import type { CaseDetail, PostTurnResponse, TurnPage } from '../types'
import { ConversationPane } from './ConversationPane'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchCaseDetail: vi.fn<typeof actual.fetchCaseDetail>(),
    fetchTurns: vi.fn<typeof actual.fetchTurns>(),
    postAnalystTurn: vi.fn<typeof actual.postAnalystTurn>(),
    markCaseRead: vi.fn<typeof actual.markCaseRead>(),
    closeCase: vi.fn<typeof actual.closeCase>(),
  }
})

const page = (overrides: Partial<TurnPage> = {}): TurnPage => ({
  items: seededTurns(),
  olderCursor: null,
  lastSequence: 4,
  ...overrides,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(detail: CaseDetail = makeCaseDetail(), turns: TurnPage = page()) {
  vi.mocked(api.fetchCaseDetail).mockResolvedValue(detail)
  vi.mocked(api.fetchTurns).mockResolvedValue(turns)
  vi.mocked(api.markCaseRead).mockResolvedValue(detail.case)
  const onClosed = vi.fn<(caseId: string) => void>()
  const onOpenHistory = vi.fn<() => void>()
  const view = renderWithProviders(
    <ConversationPane caseId={detail.case.id} onClosed={onClosed} onOpenHistory={onOpenHistory} />,
    { staff: analystStaff },
  )
  return { ...view, onClosed, onOpenHistory }
}

function response(text: string, clientMessageId: string, sequence = 5): PostTurnResponse {
  return {
    turn: makeAnalystTurn(sequence, text, clientMessageId),
    case: makeCaseSummary({
      version: 4,
      lastSequence: sequence,
      assignedAnalystId: analystStaff.id,
    }),
  }
}

beforeEach(() => {
  vi.mocked(api.postAnalystTurn).mockReset()
})

describe('ConversationPane · chat', () => {
  it('renders the header, "Cómo llegó a ti" and every kind of turn', async () => {
    setup()
    expect(
      await screen.findByRole('heading', { name: 'Marcela Quintana Pardo' }),
    ).toBeInTheDocument()
    expect(screen.getByText(CASE_ID)).toBeInTheDocument()
    expect(
      // Slice 8: the priority left the meta line (it is a menu now).
      screen.getByText(/· Colombia · Barranquilla · chat web$/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Datos de ejemplo')).not.toBeInTheDocument()
    // Short facts, never a sentence (slice 6 UI rule).
    const arrival = screen.getByText('Cómo llegó a ti').parentElement!
    expect(
      within(arrival)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Estabas disponible', 'Hablas español'])
    expect(arrival).toHaveTextContent('Asignado: 5 mar, 10:46')
    expect(arrival.textContent).not.toContain('·')

    const messages = await screen.findByRole('list', { name: 'Mensajes' })
    expect(within(messages).getByText(/hay un cargo en mi tarjeta/)).toBeInTheDocument()
    expect(within(messages).getByText(/Recibimos tu mensaje/)).toBeInTheDocument()
    expect(
      within(messages).getByText(/Asignado a Daniela Ríos porque está disponible/),
    ).toBeInTheDocument()
    expect(within(messages).getByText(/Soy Daniela, de LATAM Bank/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Escribe al cliente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar caso' })).toBeEnabled()
    // No previous cases: no history button. No support panel, call bar or e-mail layout.
    expect(screen.queryByRole('button', { name: /Casos anteriores/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('offers "Casos anteriores (n)" when the customer has other cases', async () => {
    const { user, onOpenHistory } = setup(makeCaseDetail({ previousCaseCount: 2 }))
    await user.click(await screen.findByRole('button', { name: 'Casos anteriores (2)' }))
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('subscribes to the case topic', async () => {
    const { sockets } = setup()
    await screen.findByRole('list', { name: 'Mensajes' })
    act(() => sockets.last()?.open())
    expect(sockets.last()?.messages()).toContainEqual({
      action: 'subscribe',
      topic: `case:${CASE_ID}`,
    })
  })

  it('sends optimistically and settles once, even with the realtime echo', async () => {
    const pending = deferred<PostTurnResponse>()
    vi.mocked(api.postAnalystTurn).mockReturnValue(pending.promise)
    const { user, sockets } = setup()
    const box = await screen.findByRole('textbox', { name: 'Escribe al cliente' })
    await screen.findByRole('list', { name: 'Mensajes' })
    act(() => sockets.last()?.open())

    await user.type(box, 'Hola, Marcela. Ya reviso tu caso.{Enter}')
    expect(box).toHaveValue('')
    expect(screen.getByText('Hola, Marcela. Ya reviso tu caso.')).toBeInTheDocument()
    expect(screen.getByText('Enviando…')).toBeInTheDocument()

    const [caseId, body] = vi.mocked(api.postAnalystTurn).mock.calls[0]!
    expect(caseId).toBe(CASE_ID)
    expect(body.text).toBe('Hola, Marcela. Ya reviso tu caso.')

    // The echo can beat the POST response: same clientMessageId, one bubble.
    const confirmed = response(body.text, body.clientMessageId)
    act(() => sockets.last()?.receive(envelope('turn.created', confirmed.turn)))
    await act(async () => pending.resolve(confirmed))

    await waitFor(() => expect(screen.queryByText('Enviando…')).not.toBeInTheDocument())
    expect(screen.getAllByText('Hola, Marcela. Ya reviso tu caso.')).toHaveLength(1)
  })

  it('keeps Shift+Enter as a new line', async () => {
    const { user } = setup()
    const box = await screen.findByRole('textbox', { name: 'Escribe al cliente' })
    await user.type(box, 'línea uno{Shift>}{Enter}{/Shift}línea dos')
    expect(box).toHaveValue('línea uno\nlínea dos')
    expect(api.postAnalystTurn).not.toHaveBeenCalled()
  })

  it('marks a failed send and retries it with the same clientMessageId', async () => {
    vi.mocked(api.postAnalystTurn).mockRejectedValueOnce(ApiProblem.network())
    const { user } = setup()
    const box = await screen.findByRole('textbox', { name: 'Escribe al cliente' })
    await user.type(box, '¿Me confirma la fecha?')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))

    expect(await screen.findByText('No se envió')).toBeInTheDocument()
    const firstId = vi.mocked(api.postAnalystTurn).mock.calls[0]![1].clientMessageId

    vi.mocked(api.postAnalystTurn).mockResolvedValueOnce(
      response('¿Me confirma la fecha?', firstId),
    )
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    await waitFor(() => expect(screen.queryByText('No se envió')).not.toBeInTheDocument())
    expect(vi.mocked(api.postAnalystTurn).mock.calls[1]![1].clientMessageId).toBe(firstId)
    expect(screen.getAllByText('¿Me confirma la fecha?')).toHaveLength(1)
  })

  it('does not offer a retry when the case was closed meanwhile', async () => {
    vi.mocked(api.postAnalystTurn).mockRejectedValueOnce(
      new ApiProblem({ status: 409, code: 'case_closed' }),
    )
    const { user } = setup()
    await user.type(
      await screen.findByRole('textbox', { name: 'Escribe al cliente' }),
      'Hola{Enter}',
    )
    expect(await screen.findByText('No se envió: el caso ya está cerrado.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
  })

  it('merges live customer turns and fills sequence gaps', async () => {
    const { sockets } = setup()
    await screen.findByRole('list', { name: 'Mensajes' })
    act(() => sockets.last()?.open())

    act(() =>
      sockets.last()?.receive(envelope('turn.created', makeTurn({ sequence: 5, text: 'hola?' }))),
    )
    expect(await screen.findByText('hola?')).toBeInTheDocument()

    vi.mocked(api.fetchTurns).mockResolvedValueOnce({
      items: [
        makeTurn({ sequence: 6, text: 'hola?? hay alguien??' }),
        makeTurn({ sequence: 7, text: 'contesten!!' }),
      ],
      olderCursor: null,
      lastSequence: 7,
    })
    act(() =>
      sockets
        .last()
        ?.receive(envelope('turn.created', makeTurn({ sequence: 7, text: 'contesten!!' }))),
    )
    expect(await screen.findByText('hola?? hay alguien??')).toBeInTheDocument()
    expect(api.fetchTurns).toHaveBeenLastCalledWith(
      CASE_ID,
      { afterSequence: 5, limit: 200 },
      expect.anything(),
    )
    expect(screen.getAllByText('contesten!!')).toHaveLength(1)
  })

  it('loads older messages above the current ones', async () => {
    const { user } = setup(
      makeCaseDetail(),
      page({ items: seededTurns().slice(2), olderCursor: 'c-1' }),
    )
    const button = await screen.findByRole('button', { name: 'Cargar mensajes anteriores' })
    const olderPage = deferred<TurnPage>()
    vi.mocked(api.fetchTurns).mockReturnValueOnce(olderPage.promise)
    await user.click(button)
    // History is not news: the log is busy while the older page is merged.
    const log = screen.getByRole('log', { name: 'Conversación del caso' })
    expect(log).toHaveAttribute('aria-busy', 'true')
    await act(async () =>
      olderPage.resolve({ items: seededTurns().slice(0, 2), olderCursor: null, lastSequence: 4 }),
    )
    expect(await screen.findByText(/hay un cargo en mi tarjeta/)).toBeInTheDocument()
    await waitFor(() => expect(log).not.toHaveAttribute('aria-busy'))
    expect(api.fetchTurns).toHaveBeenLastCalledWith(CASE_ID, { cursor: 'c-1' })
    expect(
      screen.queryByRole('button', { name: 'Cargar mensajes anteriores' }),
    ).not.toBeInTheDocument()
  })

  it('marks a new case as read with the last sequence', async () => {
    const detail = makeCaseDetail()
    detail.case = { ...detail.case, status: 'assigned', inboxStatus: 'new', lastSequence: 4 }
    setup(detail)
    await waitFor(() => expect(api.markCaseRead).toHaveBeenCalledWith(CASE_ID, 4), {
      timeout: 2000,
    })
  })
})

describe('ConversationPane · ordering and gaps', () => {
  it('posts quick replies one after another, in the order they were typed', async () => {
    const posts = [deferred<PostTurnResponse>(), deferred<PostTurnResponse>()]
    vi.mocked(api.postAnalystTurn)
      .mockReturnValueOnce(posts[0]!.promise)
      .mockReturnValueOnce(posts[1]!.promise)
    const { user } = setup()
    const box = await screen.findByRole('textbox', { name: 'Escribe al cliente' })
    await user.type(box, 'uno{Enter}')
    await user.type(box, 'dos{Enter}')
    // The second POST waits for the first: the server numbers turns in commit order.
    expect(api.postAnalystTurn).toHaveBeenCalledTimes(1)
    const first = vi.mocked(api.postAnalystTurn).mock.calls[0]![1]
    expect(first.text).toBe('uno')
    await act(async () => posts[0]!.resolve(response('uno', first.clientMessageId, 5)))
    await waitFor(() => expect(api.postAnalystTurn).toHaveBeenCalledTimes(2))
    const second = vi.mocked(api.postAnalystTurn).mock.calls[1]![1]
    expect(second.text).toBe('dos')
    await act(async () => posts[1]!.resolve(response('dos', second.clientMessageId, 6)))
    await waitFor(() => expect(screen.queryByText('Enviando…')).not.toBeInTheDocument())
    const texts = within(screen.getByRole('list', { name: 'Mensajes' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(texts.findIndex((t) => t?.includes('uno'))).toBeLessThan(
      texts.findIndex((t) => t?.includes('dos')),
    )
  })

  it('catches up on a customer turn missed while the socket was down', async () => {
    // Socket down: the customer wrote seq 5; our reply comes back over REST as 6.
    vi.mocked(api.postAnalystTurn).mockImplementation(async (_caseId, body) =>
      response(body.text, body.clientMessageId, 6),
    )
    const { user } = setup()
    const box = await screen.findByRole('textbox', { name: 'Escribe al cliente' })
    await screen.findByRole('list', { name: 'Mensajes' })
    vi.mocked(api.fetchTurns).mockResolvedValueOnce({
      items: [
        makeTurn({ sequence: 5, text: 'fue el 9 de enero' }),
        makeAnalystTurn(6, 'Ya lo reviso', 'ignored'),
      ],
      olderCursor: null,
      lastSequence: 6,
    })
    await user.type(box, 'Ya lo reviso{Enter}')
    expect(await screen.findByText('fue el 9 de enero')).toBeInTheDocument()
    // Asked from the hole (4), not from the highest turn held (6).
    expect(api.fetchTurns).toHaveBeenLastCalledWith(
      CASE_ID,
      { afterSequence: 4, limit: 200 },
      expect.anything(),
    )
    expect(screen.getAllByText('Ya lo reviso')).toHaveLength(1)
  })
})

describe('ConversationPane · accessibility', () => {
  it('keeps the focus in the composer after sending with the button', async () => {
    vi.mocked(api.postAnalystTurn).mockImplementation(async (_caseId, body) =>
      response(body.text, body.clientMessageId),
    )
    const { user } = setup()
    const box = await screen.findByRole('textbox', { name: 'Escribe al cliente' })
    const send = screen.getByRole('button', { name: 'Enviar' })
    expect(send).toHaveAttribute('aria-disabled', 'true')
    await user.click(send)
    expect(api.postAnalystTurn).not.toHaveBeenCalled()
    await user.type(box, 'Hola')
    expect(send).not.toHaveAttribute('aria-disabled')
    send.focus()
    await user.keyboard('{Enter}')
    expect(api.postAnalystTurn).toHaveBeenCalledTimes(1)
    expect(box).toHaveFocus()
  })

  it('mounts the live log with the history in it and updates a sent bubble in place', async () => {
    const turns = deferred<TurnPage>()
    const post = deferred<PostTurnResponse>()
    vi.mocked(api.postAnalystTurn).mockReturnValue(post.promise)
    const detail = makeCaseDetail()
    vi.mocked(api.fetchCaseDetail).mockResolvedValue(detail)
    vi.mocked(api.fetchTurns).mockReturnValue(turns.promise)
    vi.mocked(api.markCaseRead).mockResolvedValue(detail.case)
    const { user } = renderWithProviders(<ConversationPane caseId={CASE_ID} />, {
      staff: analystStaff,
    })
    await screen.findByRole('heading', { name: 'Marcela Quintana Pardo' })
    // The skeleton is not inside a live region: nothing to announce yet.
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
    await act(async () => turns.resolve(page()))
    const log = await screen.findByRole('log', { name: 'Conversación del caso' })
    expect(log).toHaveAttribute('aria-relevant', 'additions')
    expect(within(log).getByText(/hay un cargo en mi tarjeta/)).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Escribe al cliente' }), 'Hola{Enter}')
    const bubble = within(log).getByText('Hola').closest('li')
    const body = vi.mocked(api.postAnalystTurn).mock.calls[0]![1]
    await act(async () => post.resolve(response('Hola', body.clientMessageId)))
    await waitFor(() => expect(screen.queryByText('Enviando…')).not.toBeInTheDocument())
    // Same node from "Enviando…" to sent: the message is announced once.
    expect(within(log).getByText('Hola').closest('li')).toBe(bubble)
  })

  it('keeps "Cargar mensajes anteriores" outside the live log', async () => {
    setup(makeCaseDetail(), page({ items: seededTurns().slice(2), olderCursor: 'c-1' }))
    const log = await screen.findByRole('log', { name: 'Conversación del caso' })
    const button = screen.getByRole('button', { name: 'Cargar mensajes anteriores' })
    expect(log).not.toContainElement(button)
  })

  it('shows the meta line whole, with "en portugués", and a short case number', async () => {
    const detail = makeCaseDetail()
    detail.case = { ...detail.case, language: 'pt' }
    setup(detail)
    const header = (await screen.findByRole('heading', { name: 'Marcela Quintana Pardo' }))
      .parentElement!
    expect(header).toHaveTextContent(/Colombia · Barranquilla · chat web · en portugués/)
    expect(within(header).getByText('CASE-…0101')).toBeInTheDocument()
    expect(within(header).getByTitle(CASE_ID)).toBeInTheDocument()
    expect(
      within(header).getByRole('button', { name: 'Copiar número de caso' }),
    ).toBeInTheDocument()
  })

  it('moves the focus to the case heading when asked (programmatic switch)', async () => {
    const detail = makeCaseDetail()
    vi.mocked(api.fetchCaseDetail).mockResolvedValue(detail)
    vi.mocked(api.fetchTurns).mockResolvedValue(page())
    vi.mocked(api.markCaseRead).mockResolvedValue(detail.case)
    const onFocused = vi.fn<() => void>()
    renderWithProviders(<ConversationPane caseId={CASE_ID} focusOnLoad onFocused={onFocused} />, {
      staff: analystStaff,
    })
    const heading = await screen.findByRole('heading', { name: 'Marcela Quintana Pardo' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(onFocused).toHaveBeenCalledTimes(1)
  })
})

describe('ConversationPane · states', () => {
  it('shows a closed case read-only, with the closure, the note and no composer', async () => {
    setup(makeClosedDetail())
    const footer = await screen.findByRole('note', { name: 'Solo lectura' })
    expect(footer).toHaveTextContent('Resuelto')
    expect(footer).toHaveTextContent('Cerrado: 5 mar, 10:58')
    expect(footer.textContent).not.toContain('·')
    // The reason's icon and tone (slice 6), not the lock.
    expect(footer.querySelector('[data-reason="resolved"]')).toHaveClass('bg-success-soft')
    expect(footer).toHaveTextContent('Nota: Se explicó el plazo del reverso (5 días hábiles).')
    expect(screen.queryByRole('textbox', { name: 'Escribe al cliente' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cerrar caso' })).not.toBeInTheDocument()
    expect(screen.getByText('Cerrado', { selector: 'header span' })).toBeInTheDocument()
    // A closed case is never marked read.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(api.markCaseRead).not.toHaveBeenCalled()
  })

  it("adds the customer's rating and comment to a closed case's footer (slice 7)", async () => {
    const closed = makeClosedDetail()
    setup({
      ...closed,
      case: {
        ...closed.case,
        rating: { score: 3, comment: 'Muy amable', ratedAt: '2026-03-05T16:05:00Z' },
      },
    })
    const footer = await screen.findByRole('note', { name: 'Solo lectura' })
    // Slice 8: the face and one word; screen readers hear whose rating it is.
    const pill = footer.querySelector<HTMLElement>('[data-score="3"]')!
    expect(pill).toHaveTextContent(/^Calificación del cliente: Bien$/)
    expect(pill).toHaveClass('bg-success-soft')
    expect(pill.querySelector('.sr-only')).toHaveTextContent('Calificación del cliente:')
    expect(footer).not.toHaveTextContent(/calificó/i)
    expect(pill.querySelector('.lucide-smile')).not.toBeNull()
    expect(footer).toHaveTextContent('“Muy amable”')
    expect(footer.textContent).not.toContain('·')
  })

  it('shows no rating line while the customer has not rated (slice 7)', async () => {
    setup(makeClosedDetail())
    const footer = await screen.findByRole('note', { name: 'Solo lectura' })
    expect(footer).not.toHaveTextContent(/calificó/i)
  })

  it('updates the footer when the rating arrives live (slice 7)', async () => {
    const closed = makeClosedDetail()
    const { sockets } = setup(closed)
    const footer = await screen.findByRole('note', { name: 'Solo lectura' })
    act(() => sockets.last()?.open())
    act(() =>
      sockets.last()?.receive(
        envelope('case.updated', {
          ...closed.case,
          version: closed.case.version + 1,
          rating: { score: 1, comment: null, ratedAt: '2026-03-05T16:05:00Z' },
        }),
      ),
    )
    await waitFor(() => expect(footer.querySelector('[data-score="1"]')).not.toBeNull())
    const pill = footer.querySelector('[data-score="1"]')!
    expect(pill).toHaveTextContent(/^Calificación del cliente: Mal$/)
    expect(pill).toHaveClass('bg-danger-soft')
  })

  it("shows another analyst's case read-only (history access)", async () => {
    setup(makeJulianDetail(), page({ items: julianTurns(), lastSequence: 3 }))
    expect(await screen.findByText('Quién lo atendió')).toBeInTheDocument()
    expect(screen.queryByText('Cómo llegó a ti')).not.toBeInTheDocument()
    expect(screen.getByText('Quién lo atendió').parentElement).toHaveTextContent('Julián Ortega')
    const footer = await screen.findByRole('note', { name: 'Solo lectura' })
    expect(footer).toHaveTextContent('Resuelto')
    expect(footer).toHaveTextContent('Cerrado: 13 feb, 10:15')
    expect(footer).toHaveTextContent('Lo cerró: Julián Ortega')
    const messages = await screen.findByRole('list', { name: 'Mensajes' })
    expect(within(messages).getByText(/Soy Julián, de LATAM Bank/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Escribe al cliente' })).not.toBeInTheDocument()
  })

  it('says whose case it is when the viewer is not the assignee of an open case', async () => {
    const base = makeCaseDetail()
    setup(
      makeCaseDetail({
        capabilities: {
          canReply: false,
          replyBlockedReason: 'not_assignee',
          canClose: false,
          canAssign: false,
          canChangePriority: false,
          canEscalate: false,
        },
        assignment: { ...base.assignment!, analystId: 'STF-2', analystName: 'Julián Ortega' },
      }),
    )
    const footer = await screen.findByRole('note', { name: 'Solo lectura' })
    expect(within(footer).getByText('Solo lectura')).toBeInTheDocument()
    expect(within(footer).getByText('Lo atiende Julián Ortega')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Escribe al cliente' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cerrar caso' })).not.toBeInTheDocument()
  })

  it('keeps the draft and says who holds the case once supervision took it away', async () => {
    const { user, queryClient } = setup()
    const box = await screen.findByRole('textbox', { name: 'Escribe al cliente' })
    await user.type(box, 'Ya casi lo tengo,{Shift>}{Enter}{/Shift}un momento')

    const base = makeCaseDetail()
    vi.mocked(api.fetchCaseDetail).mockResolvedValue(
      makeCaseDetail({
        capabilities: {
          canReply: false,
          replyBlockedReason: 'not_assignee',
          canClose: false,
          canAssign: false,
          canChangePriority: false,
          canEscalate: false,
        },
        assignment: {
          ...base.assignment!,
          analystId: 'STF-2',
          analystName: 'Julián Ortega',
          reason: 'manual',
          assignedByRole: 'supervisor',
          assignedByName: 'Lucía Herrera',
          previousAnalystId: analystStaff.id,
          previousAnalystName: analystStaff.name,
        },
      }),
    )
    await act(() =>
      queryClient.invalidateQueries({ queryKey: api.conversationKeys.detail(CASE_ID) }),
    )

    expect(await screen.findByText('Quién lo atiende')).toBeInTheDocument()
    expect(screen.queryByText('Cómo llegó a ti')).not.toBeInTheDocument()
    const holder = screen.getByText('Quién lo atiende').parentElement!
    expect(
      within(holder)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Julián Ortega', 'Asignado por Lucía Herrera'])
    expect(screen.queryByRole('textbox', { name: 'Escribe al cliente' })).not.toBeInTheDocument()
    const draft = screen.getByRole('note', { name: 'Borrador sin enviar' })
    expect(draft).toHaveTextContent('Tu borrador no se envió')
    expect(draft).toHaveTextContent('Ya casi lo tengo, un momento')
    expect(screen.getByText('Lo atiende Julián Ortega')).toBeInTheDocument()

    await user.click(within(draft).getByRole('button', { name: 'Descartar borrador' }))
    expect(screen.queryByText('Tu borrador no se envió')).not.toBeInTheDocument()
  })

  it('shows why a case cannot be opened', async () => {
    vi.mocked(api.fetchCaseDetail).mockRejectedValue(
      new ApiProblem({ status: 403, code: 'case_not_assigned' }),
    )
    vi.mocked(api.fetchTurns).mockRejectedValue(
      new ApiProblem({ status: 403, code: 'case_not_assigned' }),
    )
    renderWithProviders(<ConversationPane caseId={CASE_ID} />, { staff: analystStaff })
    expect(await screen.findByText('No tienes acceso a este caso')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})

describe('ConversationPane · close', () => {
  it('requires a reason, sends it with the trimmed note and reports back', async () => {
    const closed = makeClosedDetail()
    vi.mocked(api.closeCase).mockResolvedValue(closed)
    const { user, onClosed } = setup()

    await user.click(await screen.findByRole('button', { name: 'Cerrar caso' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cerrar caso' })
    // The customer and the case number as two elements (no "·").
    expect(dialog).toHaveAccessibleDescription(/Marcela Quintana Pardo\s*CASE-…0101/)
    expect(within(dialog).getByText('CASE-…0101')).toHaveClass('font-mono')
    const reasons = within(dialog).getByRole('radiogroup', { name: /Motivo/ })
    const radios = within(reasons).getAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual([
      'resolved',
      'customer_unresponsive',
      'duplicate',
      'out_of_scope',
      'other',
    ])
    // Cards (slice 6): bold label as the name, the meaning as the description,
    // the reason's icon tile; the radio itself is visually hidden.
    const copy = [
      ['Resuelto', 'Se atendió lo que pidió.'],
      ['El cliente no respondió', 'Dejó de contestar y no se pudo seguir.'],
      ['Duplicado', 'Ya hay otro caso por lo mismo.'],
      ['Fuera de alcance', 'Lo que pide no lo atiende este equipo.'],
      ['Otro', 'Cuéntalo en la nota interna.'],
    ] as const
    copy.forEach(([name, meaning], index) => {
      expect(radios[index]).toHaveAccessibleName(name)
      expect(radios[index]).toHaveAccessibleDescription(meaning)
    })
    expect(radios[0]).toHaveClass('sr-only')
    expect(radios[4]!.closest('label')).toHaveClass('col-span-2')
    expect(radios[0]!.closest('label')?.querySelector('[data-reason="resolved"]')).toHaveClass(
      'bg-success-soft',
    )

    await user.click(within(dialog).getByRole('button', { name: 'Cerrar caso' }))
    expect(await within(dialog).findByText('Elige un motivo.')).toBeInTheDocument()
    expect(reasons).toHaveAttribute('aria-invalid', 'true')
    expect(within(reasons).getByRole('radio', { name: 'Resuelto' })).toHaveFocus()
    expect(api.closeCase).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('radio', { name: 'Duplicado' }))
    expect(within(dialog).queryByText('Elige un motivo.')).not.toBeInTheDocument()
    // The selected card: the reason's soft background and a 2px border in its ink.
    const duplicate = within(dialog).getByRole('radio', { name: 'Duplicado' }).closest('label')
    expect(duplicate).toHaveClass('border-2', 'border-accent-strong', 'bg-accent-soft')
    expect(within(dialog).getByRole('radio', { name: 'Resuelto' }).closest('label')).toHaveClass(
      'border-border',
    )
    const note = within(dialog).getByRole('textbox', { name: 'Nota interna (opcional)' })
    expect(note).toHaveAccessibleDescription('Solo la ve el equipo.')
    await user.type(note, '  Mismo caso que el 104.  ')
    expect(within(dialog).getByText('22/500')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar caso' }))

    await waitFor(() => expect(onClosed).toHaveBeenCalledWith(CASE_ID))
    expect(api.closeCase).toHaveBeenCalledWith(CASE_ID, {
      reason: 'duplicate',
      note: 'Mismo caso que el 104.',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('note', { name: 'Solo lectura' })).toBeInTheDocument()
    expect(screen.getByText('Cerrado', { selector: 'header span' })).toBeInTheDocument()
  })

  it('previews the notice the customer will see, in the case language', async () => {
    const pt = makeCaseDetail()
    pt.case = { ...pt.case, language: 'pt' }
    const { user } = setup(pt)
    await user.click(await screen.findByRole('button', { name: 'Cerrar caso' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cerrar caso' })
    const preview = within(dialog).getByText('El cliente verá').parentElement!
    expect(preview).toHaveTextContent(
      'A conversa foi encerrada. Se precisar de algo mais, escreva para nós e abrimos uma nova conversa.',
    )
    expect(within(dialog).getByText(/^A conversa foi encerrada/)).toHaveAttribute('lang', 'pt')
  })

  it('rejects a note over 500 characters before sending', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Cerrar caso' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cerrar caso' })
    await user.click(within(dialog).getByRole('radio', { name: 'Otro' }))
    const note = within(dialog).getByRole('textbox', { name: 'Nota interna (opcional)' })
    await user.click(note)
    await user.paste('a'.repeat(501))
    expect(within(dialog).getByText('501/500')).toBeInTheDocument()
    expect(
      within(dialog).getAllByText('La nota puede tener hasta 500 caracteres.').length,
    ).toBeGreaterThan(0)
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar caso' }))
    expect(note).toHaveFocus()
    expect(api.closeCase).not.toHaveBeenCalled()
  })

  it('explains a server rejection', async () => {
    vi.mocked(api.closeCase).mockRejectedValue(new ApiProblem({ status: 409, code: 'case_closed' }))
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Cerrar caso' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cerrar caso' })
    await user.click(within(dialog).getByRole('radio', { name: 'Resuelto' }))
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar caso' }))
    expect(await within(dialog).findByText('Este caso ya estaba cerrado.')).toBeInTheDocument()
  })
})

describe('ConversationPane · supervision mode (slice 3)', () => {
  it('never offers the composer, the close or the read cursor, even to the assignee', async () => {
    const detail = makeCaseDetail()
    detail.case = { ...detail.case, status: 'assigned', inboxStatus: 'new', unreadCount: 1 }
    vi.mocked(api.fetchCaseDetail).mockResolvedValue(detail)
    vi.mocked(api.fetchTurns).mockResolvedValue(page())
    renderWithProviders(
      <ConversationPane
        caseId={CASE_ID}
        mode="supervision"
        headerActions={<button type="button">Reasignar</button>}
      />,
      { staff: analystStaff },
    )
    expect(await screen.findByRole('button', { name: 'Reasignar' })).toBeInTheDocument()
    await screen.findByRole('list', { name: 'Mensajes' })
    expect(screen.queryByRole('textbox', { name: 'Escribe al cliente' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cerrar caso' })).not.toBeInTheDocument()
    expect(screen.getByText('Solo lectura: lo atiende Daniela Ríos.')).toBeInTheDocument()
    const arrival = screen.getByText('Cómo llegó').parentElement!.parentElement!
    expect(arrival).toHaveTextContent(
      'Lo atiende Daniela Ríos: le llegó al estar disponible y hablar español',
    )
    expect(arrival).toHaveTextContent('5 mar, 10:46')
    expect(arrival).not.toHaveTextContent('·')
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(api.markCaseRead).not.toHaveBeenCalled()
  })

  it('shows a closed case as closure facts, never a " · " joined line', async () => {
    const detail = makeJulianDetail()
    vi.mocked(api.fetchCaseDetail).mockResolvedValue(detail)
    vi.mocked(api.fetchTurns).mockResolvedValue(page({ items: julianTurns(), lastSequence: 3 }))
    renderWithProviders(<ConversationPane caseId={detail.case.id} mode="supervision" />, {
      staff: analystStaff,
    })
    const footer = await screen.findByRole('note', { name: 'Solo lectura' })
    expect(footer).toHaveTextContent('Resuelto')
    expect(footer).toHaveTextContent('Cerrado: 13 feb, 10:15')
    expect(footer).toHaveTextContent('Lo cerró: Julián Ortega')
    expect(footer).not.toHaveTextContent('·')
    expect(footer).not.toHaveTextContent('Caso cerrado el')
  })

  it('says "Ya no puedes cerrarlo" when supervision reassigned the case meanwhile', async () => {
    vi.mocked(api.closeCase).mockRejectedValueOnce(
      new ApiProblem({ status: 403, code: 'case_not_assigned' }),
    )
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Cerrar caso' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cerrar caso' })
    await user.click(within(dialog).getByRole('radio', { name: 'Resuelto' }))
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar caso' }))
    expect(
      await within(dialog).findByText(
        'Ya no puedes cerrarlo: supervisión pasó este caso a otra persona.',
      ),
    ).toBeInTheDocument()
  })
})
