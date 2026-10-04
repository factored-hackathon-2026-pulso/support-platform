import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCaseSummary } from '@/test/case-fixtures'
import { CALL_ID, makeCall, makeEmail, makeLine } from '@/test/channel-fixtures'
import { CASE_ID, envelope, makeCaseDetail, makeTurn } from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import type { Call, CaseDetail, Turn } from '../types'
import { ConversationPane } from './ConversationPane'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchCaseDetail: vi.fn<typeof actual.fetchCaseDetail>(),
    fetchTurns: vi.fn<typeof actual.fetchTurns>(),
    markCaseRead: vi.fn<typeof actual.markCaseRead>(),
    fetchCalls: vi.fn<typeof actual.fetchCalls>(),
    commandCall: vi.fn<typeof actual.commandCall>(),
    muteCall: vi.fn<typeof actual.muteCall>(),
    startCall: vi.fn<typeof actual.startCall>(),
    postCallLine: vi.fn<typeof actual.postCallLine>(),
    postNote: vi.fn<typeof actual.postNote>(),
    replyByEmail: vi.fn<typeof actual.replyByEmail>(),
  }
})

const capabilities = {
  canReply: true,
  replyBlockedReason: null,
  canClose: true,
  canAssign: false,
  canChangePriority: true,
  canEscalate: false,
  canCall: false,
  canEmail: true,
  canAddNote: true,
} as const

/** Marcela's case 101 as a phone case of the signed-in analyst (or another channel). */
function channelDetail(
  channel: CaseDetail['case']['channel'],
  activeCall: Call | null,
  overrides: Partial<CaseDetail['capabilities']> = {},
): CaseDetail {
  const detail = makeCaseDetail()
  return {
    ...detail,
    activeCall,
    case: { ...detail.case, channel, activeCallId: activeCall?.id ?? null },
    capabilities: { ...capabilities, ...overrides },
  }
}

const callLines = (): Turn[] => [
  makeLine(1, 'Buenas tardes, le habla Daniela.', 'analyst', 0),
  makeLine(2, 'Hola, veo dos compras que no hice.', 'customer', 6),
]

function setup(detail: CaseDetail, turns: Turn[], calls: Call[] = [], mode?: 'supervision') {
  vi.mocked(api.fetchCaseDetail).mockResolvedValue(detail)
  vi.mocked(api.fetchTurns).mockResolvedValue({
    items: turns,
    olderCursor: null,
    lastSequence: turns.length,
  })
  vi.mocked(api.markCaseRead).mockResolvedValue(detail.case)
  vi.mocked(api.fetchCalls).mockResolvedValue({
    items: calls,
    serverTime: '2026-03-05T16:05:00Z',
  })
  return renderWithProviders(<ConversationPane caseId={CASE_ID} mode={mode} />, {
    staff: analystStaff,
  })
}

const bar = () => screen.findByRole('region', { name: 'Llamada' })

beforeEach(() => {
  for (const fn of [api.commandCall, api.muteCall, api.postCallLine, api.postNote]) {
    vi.mocked(fn).mockReset()
  }
})

describe('ConversationPane · call (slice 12)', () => {
  it('rings an inbound call: "Sonando", "Contestar", no "Cerrar caso", then talks', async () => {
    const ringing = makeCall({ state: 'ringing', answeredAt: null })
    const { user } = setup(channelDetail('phone_inbound', ringing), [], [ringing])
    const callBar = await bar()
    expect(within(callBar).getByRole('status')).toHaveTextContent('Sonando')
    expect(callBar).toHaveTextContent('Entrante')
    expect(within(callBar).getByTitle('Duración de la llamada')).toHaveTextContent(/\d\d:\d\d/)
    expect(screen.queryByRole('button', { name: 'Cerrar caso' })).not.toBeInTheDocument()
    expect(screen.getByText('Transcripción en vivo')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Lo que dices' })).toBeDisabled()
    expect(screen.getByText('Contesta para hablar con el cliente.')).toBeInTheDocument()

    const answered = makeCall({ version: 2 })
    vi.mocked(api.commandCall).mockResolvedValue({
      call: answered,
      case: makeCaseSummary({ version: 4, activeCallId: CALL_ID }),
    })
    await user.click(within(callBar).getByRole('button', { name: 'Contestar' }))
    expect(api.commandCall).toHaveBeenCalledWith(CASE_ID, CALL_ID, 'answer')
    await waitFor(() => expect(within(callBar).getByRole('status')).toHaveTextContent('En llamada'))
    for (const name of ['Poner en espera', 'Silenciar', 'Colgar']) {
      expect(within(callBar).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('textbox', { name: 'Lo que dices' })).toBeEnabled()
  })

  it('shows the live transcript with times and speakers, and posts what the analyst says', async () => {
    const call = makeCall()
    const { user } = setup(channelDetail('phone_inbound', call), callLines(), [call])
    const list = await screen.findByRole('list', { name: 'Transcripción de la llamada' })
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('00:00')
    expect(items[0]).toHaveTextContent('Tú')
    expect(items[1]).toHaveTextContent('00:06')
    expect(items[1]).toHaveTextContent('Cliente, 00:06: Hola, veo dos compras que no hice.')

    vi.mocked(api.postCallLine).mockResolvedValue({
      turn: makeLine(3, 'Ya las registré en su caso.', 'analyst', 30),
      case: makeCaseSummary({ version: 4, lastSequence: 3, activeCallId: CALL_ID }),
    })
    await user.type(
      screen.getByRole('textbox', { name: 'Lo que dices' }),
      'Ya las registré en su caso.',
    )
    await user.click(screen.getByRole('button', { name: 'Decir' }))
    expect(api.postCallLine).toHaveBeenCalledWith(CASE_ID, CALL_ID, {
      text: 'Ya las registré en su caso.',
      clientMessageId: expect.any(String),
    })
    expect(await within(list).findByText('Ya las registré en su caso.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Lo que dices' })).toHaveValue('')
  })

  it('holds, mutes and hangs up through the bar', async () => {
    const call = makeCall()
    const { user } = setup(channelDetail('phone_inbound', call), callLines(), [call])
    const callBar = await bar()
    vi.mocked(api.muteCall).mockResolvedValue({
      call: makeCall({ version: 2, muted: true }),
      case: makeCaseSummary({ version: 4, activeCallId: CALL_ID }),
    })
    await user.click(within(callBar).getByRole('button', { name: 'Silenciar' }))
    expect(api.muteCall).toHaveBeenCalledWith(CASE_ID, CALL_ID, true)
    await waitFor(() =>
      expect(within(callBar).getByRole('button', { name: 'Silenciar' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(callBar).toHaveTextContent('Silenciado')

    vi.mocked(api.commandCall).mockResolvedValue({
      call: makeCall({ version: 3, muted: true, state: 'on_hold' }),
      case: makeCaseSummary({ version: 5, activeCallId: CALL_ID }),
    })
    await user.click(within(callBar).getByRole('button', { name: 'Poner en espera' }))
    expect(api.commandCall).toHaveBeenLastCalledWith(CASE_ID, CALL_ID, 'hold')
    await waitFor(() => expect(within(callBar).getByRole('status')).toHaveTextContent('En espera'))
    expect(within(callBar).getByRole('button', { name: 'Retomar' })).toBeInTheDocument()
    expect(
      screen.getByText('La llamada está en espera. Retómala para seguir hablando.'),
    ).toBeInTheDocument()

    vi.mocked(api.commandCall).mockResolvedValue({
      call: makeCall({
        version: 4,
        state: 'ended',
        endedAt: '2026-03-05T16:06:32Z',
        endReason: 'completed',
        durationSeconds: 372,
      }),
      case: makeCaseSummary({ version: 6, activeCallId: null }),
    })
    vi.mocked(api.fetchCaseDetail).mockResolvedValue(channelDetail('phone_inbound', null))
    await user.click(within(callBar).getByRole('button', { name: 'Colgar' }))
    expect(api.commandCall).toHaveBeenLastCalledWith(CASE_ID, CALL_ID, 'hangup')
    await waitFor(() =>
      expect(within(callBar).getByRole('status')).toHaveTextContent(
        'Llamada terminada, 6 min 12 s',
      ),
    )
    expect(within(callBar).queryByRole('button')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Cerrar caso' })).toBeInTheDocument()
    expect(screen.getByText('Transcripción')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Lo que dices' })).not.toBeInTheDocument()
  })

  it('shows "Por qué llamas" on an outbound call that rings, with only "Colgar"', async () => {
    const call = makeCall({
      direction: 'outbound',
      state: 'ringing',
      answeredAt: null,
      reason: 'Retomar el cargo que consultó por chat.',
    })
    setup(channelDetail('phone_outbound', call), [], [call])
    const callBar = await bar()
    expect(callBar).toHaveTextContent('Saliente')
    expect(
      within(callBar)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Colgar'])
    const reason = screen.getByRole('region', { name: 'Por qué llamas' })
    expect(reason).toHaveTextContent('Retomar el cargo que consultó por chat.')
    expect(screen.getByText('Esperando a que el cliente conteste.')).toBeInTheDocument()
  })

  it('follows call.updated live', async () => {
    const ringing = makeCall({ state: 'ringing', answeredAt: null })
    const { sockets } = setup(channelDetail('phone_inbound', ringing), [], [ringing])
    const callBar = await bar()
    await waitFor(() => expect(api.fetchCalls).toHaveBeenCalled())
    act(() => sockets.last()?.open())
    act(() => sockets.last()?.receive(envelope('call.updated', makeCall({ version: 2 }))))
    await waitFor(() => expect(within(callBar).getByRole('status')).toHaveTextContent('En llamada'))
  })

  it('saves an internal note and offers "Llamar al cliente" with a reason', async () => {
    const { user } = setup(channelDetail('phone_inbound', null, { canCall: true }), callLines(), [
      makeCall({ state: 'ended', durationSeconds: 60, endReason: 'completed' }),
    ])
    vi.mocked(api.postNote).mockResolvedValue({
      turn: makeTurn({
        sequence: 3,
        kind: 'note',
        audience: 'staff',
        authorRole: 'analyst',
        authorId: analystStaff.id,
        text: 'Revisar con reclamos',
      }),
      case: makeCaseSummary({ version: 4, lastSequence: 3 }),
    })
    await user.type(
      await screen.findByRole('textbox', { name: 'Nota interna' }),
      'Revisar con reclamos',
    )
    await user.click(screen.getByRole('button', { name: 'Guardar nota' }))
    expect(api.postNote).toHaveBeenCalledWith(CASE_ID, {
      text: 'Revisar con reclamos',
      clientMessageId: expect.any(String),
    })
    expect(await screen.findByText('Revisar con reclamos')).toBeInTheDocument()

    const outbound = makeCall({
      id: 'CALL-2',
      direction: 'outbound',
      state: 'ringing',
      answeredAt: null,
      reason: 'Confirmar el bloqueo',
      startedAt: '2026-03-05T16:10:00Z',
    })
    vi.mocked(api.startCall).mockResolvedValue({
      call: outbound,
      case: makeCaseSummary({ version: 5, activeCallId: 'CALL-2' }),
    })
    await user.click(screen.getByRole('button', { name: 'Llamar al cliente' }))
    const dialog = screen.getByRole('dialog', { name: 'Llamar al cliente' })
    await user.click(within(dialog).getByRole('button', { name: 'Llamar' }))
    expect(within(dialog).getByText('Escribe por qué llamas.')).toBeInTheDocument()
    expect(api.startCall).not.toHaveBeenCalled()
    await user.type(
      within(dialog).getByRole('textbox', { name: /Por qué llamas/ }),
      'Confirmar el bloqueo',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Llamar' }))
    expect(api.startCall).toHaveBeenCalledWith(CASE_ID, 'Confirmar el bloqueo', expect.any(String))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(await screen.findByRole('region', { name: 'Por qué llamas' })).toHaveTextContent(
      'Confirmar el bloqueo',
    )
  })

  it('closes a call case without "El cliente verá"', async () => {
    const { user } = setup(channelDetail('phone_inbound', null), callLines(), [
      makeCall({ state: 'ended', durationSeconds: 60, endReason: 'completed' }),
    ])
    await user.click(await screen.findByRole('button', { name: 'Cerrar caso' }))
    const dialog = screen.getByRole('dialog', { name: 'Cerrar caso' })
    expect(within(dialog).queryByText('El cliente verá')).not.toBeInTheDocument()
  })

  it('shows the bar without buttons in supervision', async () => {
    const call = makeCall()
    setup(channelDetail('phone_inbound', call), callLines(), [call], 'supervision')
    const callBar = await bar()
    expect(within(callBar).getByRole('status')).toHaveTextContent('En llamada')
    expect(within(callBar).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Lo que dices' })).not.toBeInTheDocument()
  })
})

describe('ConversationPane · email (slice 12)', () => {
  const thread = (): Turn[] => [
    makeEmail(1, 'Hola, aparece dos veces el mismo cobro.\n\nGracias,\nMarcela', 'customer'),
    makeEmail(
      2,
      'Hola, Marcela:\n\n¿La hizo en la tienda?\n\nSaludos,\nDaniela Ríos',
      'analyst',
      'Re: Cobro duplicado en mi tarjeta',
    ),
    makeEmail(3, 'Sí, en la tienda del centro.', 'customer', 'Re: Cobro duplicado en mi tarjeta'),
  ]

  it('shows the thread: subject, older emails folded, the new one marked and open', async () => {
    const { user } = setup(channelDetail('email', null), thread())
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Cobro duplicado en mi tarjeta' }),
    ).toBeInTheDocument()
    const [first, second, third] = screen.getAllByRole('article')
    expect(within(first!).getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(first).toHaveTextContent('Hola, aparece dos veces el mismo cobro. Gracias, Marcela')
    expect(within(second!).getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(within(third!).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expect(third).toHaveTextContent('Nuevo')
    await user.click(within(first!).getByRole('button'))
    expect(within(first!).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })

  it('replies by email: "Para" hidden, "Re: …", greeting and signature added, attach "Pronto"', async () => {
    const { user } = setup(channelDetail('email', null), thread())
    const form = await screen.findByRole('form', { name: 'Responder por correo' })
    expect(form).toHaveTextContent('ParaMarcela Quintana Pardo')
    expect(form).toHaveTextContent('Re: Cobro duplicado en mi tarjeta')
    expect(form).toHaveTextContent('El saludo y la firma se agregan solos')
    expect(within(form).getByRole('button', { name: 'Adjuntar archivo, pronto' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByRole('textbox', { name: 'Escribe al cliente' })).not.toBeInTheDocument()

    vi.mocked(api.replyByEmail).mockResolvedValue({
      email: {
        id: 'TRN-0004-101',
        caseId: CASE_ID,
        sequence: 4,
        direction: 'out',
        subject: 'Re: Cobro duplicado en mi tarjeta',
        body: 'Hola, Marcela:\n\nYa pedimos el reverso.\n\nSaludos,\nDaniela Ríos\nLATAM Bank',
        authorRole: 'analyst',
        authorId: analystStaff.id,
        authorName: 'Daniela Ríos',
        createdAt: '2026-03-05T16:20:00Z',
        clientMessageId: 'k-1',
      },
      case: makeCaseSummary({ version: 4, lastSequence: 4 }),
    })
    await user.type(
      within(form).getByRole('textbox', { name: 'Respuesta por correo' }),
      'Ya pedimos el reverso.',
    )
    await user.click(within(form).getByRole('button', { name: 'Enviar correo' }))
    expect(api.replyByEmail).toHaveBeenCalledWith(CASE_ID, {
      body: 'Ya pedimos el reverso.',
      clientMessageId: expect.any(String),
    })
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(4))
    expect(screen.getAllByRole('article').at(-1)).toHaveTextContent('Ya pedimos el reverso.')
    // Answered: the customer's email is no longer "Nuevo".
    expect(screen.queryByText('Nuevo')).not.toBeInTheDocument()
  })

  it('asks for a subject when the case has no email yet', async () => {
    setup(channelDetail('email', null), [makeTurn({ sequence: 1 })])
    const form = await screen.findByRole('form', { name: 'Responder por correo' })
    expect(within(form).getByRole('textbox', { name: 'Asunto' })).toBeRequired()
  })

  it('tells that the closing notice goes by email', async () => {
    const { user } = setup(channelDetail('email', null), thread())
    await user.click(await screen.findByRole('button', { name: 'Cerrar caso' }))
    const dialog = screen.getByRole('dialog', { name: 'Cerrar caso' })
    expect(within(dialog).getByText('El cliente lo recibe por correo')).toBeInTheDocument()
  })
})
