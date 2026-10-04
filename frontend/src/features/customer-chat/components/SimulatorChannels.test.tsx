import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { customerSessionToken } from '@/lib/session-token'
import { CALL_ID, makeCustomerCall } from '@/test/channel-fixtures'
import {
  demoCustomers,
  envelope,
  fakeCustomerToken,
  makeCustomerConversation,
  makeCustomerTurn,
  SIM_CASE_ID,
  SIM_CUSTOMER_ID,
} from '@/test/conversation-fixtures'
import { createFakeSocketFactory } from '@/test/fake-socket'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import type { SimChannel } from '../channels'
import type { CustomerCall, CustomerConversation, CustomerTurn } from '../types'
import { CustomerSimulatorScreen } from './CustomerSimulatorScreen'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    listDemoCustomers: vi.fn<typeof actual.listDemoCustomers>(),
    fetchCustomerConversation: vi.fn<typeof actual.fetchCustomerConversation>(),
    fetchCustomerCall: vi.fn<typeof actual.fetchCustomerCall>(),
    startCustomerCall: vi.fn<typeof actual.startCustomerCall>(),
    commandCustomerCall: vi.fn<typeof actual.commandCustomerCall>(),
    postCustomerCallLine: vi.fn<typeof actual.postCustomerCallLine>(),
    sendCustomerEmail: vi.fn<typeof actual.sendCustomerEmail>(),
    rateConversation: vi.fn<typeof actual.rateConversation>(),
  }
})

/** Claudia (es-CO) and Rafael (pt-BR), seeded simulator customers. */
const CLAUDIA_ID = 'CUS-00000000000000000000001005'

function signInAs(
  customerId: string,
  {
    conversation = null,
    turns = [],
    call = null,
  }: {
    conversation?: CustomerConversation | null
    turns?: CustomerTurn[]
    call?: CustomerCall | null
  } = {},
) {
  customerSessionToken.set(fakeCustomerToken(customerId))
  vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
    conversation,
    turns,
    pastConversationCount: 0,
  })
  vi.mocked(api.fetchCustomerCall).mockResolvedValue({ call })
}

function render(channel: SimChannel | null) {
  const sockets = createFakeSocketFactory()
  const view = renderWithProviders(
    <CustomerSimulatorScreen createSocket={sockets.factory} channel={channel} />,
    { route: '/customer' },
  )
  return { ...view, sockets }
}

const open = (overrides: Partial<CustomerConversation> = {}) =>
  makeCustomerConversation({
    status: 'with_agent',
    agentName: 'Daniela',
    channel: 'phone_inbound',
    language: 'es',
    ...overrides,
  })

beforeEach(() => {
  vi.mocked(api.listDemoCustomers).mockResolvedValue({ items: demoCustomers })
  for (const fn of [
    api.startCustomerCall,
    api.commandCustomerCall,
    api.postCustomerCallLine,
    api.sendCustomerEmail,
  ]) {
    vi.mocked(fn).mockReset()
  }
})

describe('simulator · channel picker (slice 12)', () => {
  it('offers Chat, Llamar and Escribir un correo; "Llamar" dials at once', async () => {
    signInAs(CLAUDIA_ID)
    const { user } = render(null)
    const picker = await screen.findByRole('region', {
      name: '¿Cómo se comunica Claudia con el banco?',
    })
    expect(
      within(picker)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'ChatEscribe desde la app',
      'LlamarHabla con una persona',
      'Escribir un correoTe responden por correo',
    ])
    const dialing = makeCustomerCall({ state: 'ringing', answeredAt: null, agentName: null })
    vi.mocked(api.startCustomerCall).mockResolvedValue({
      call: dialing,
      conversation: makeCustomerConversation({ status: 'waiting_agent', language: 'es' }),
      caseCreated: true,
    })
    vi.mocked(api.fetchCustomerCall).mockResolvedValue({ call: dialing })
    await user.click(within(picker).getByRole('button', { name: /^Llamar/ }))
    expect(api.startCustomerCall).toHaveBeenCalledWith(expect.any(String))
    const call = await screen.findByRole('region', { name: 'Llamada con el banco' })
    expect(within(call).getByText('Llamando…')).toBeInTheDocument()
    expect(call).toHaveTextContent('Línea de atención LATAM Bank')
    expect(within(call).getByRole('button', { name: 'Colgar' })).toBeInTheDocument()
    expect(within(call).queryByRole('button', { name: 'Silenciar' })).not.toBeInTheDocument()
  })
})

describe('simulator · call (slice 12)', () => {
  const at = (seconds: number) =>
    new Date(Date.UTC(2026, 2, 5, 16, 0, 20) + seconds * 1000).toISOString()
  const lines = [
    makeCustomerTurn({
      sequence: 3,
      kind: 'transcript',
      authorRole: 'analyst',
      authorName: 'Daniela',
      language: 'es',
      text: 'Buenas tardes, le habla Daniela.',
      createdAt: at(0),
    }),
  ]

  it('talks with the analyst: title, timer, lines both ways, a local mute', async () => {
    signInAs(CLAUDIA_ID, { conversation: open(), turns: lines, call: makeCustomerCall() })
    const { user } = render('call')
    const call = await screen.findByRole('region', { name: 'Llamada con el banco' })
    expect(await within(call).findByText('Te atiende Daniela')).toBeInTheDocument()
    expect(call).toHaveTextContent(/Duración \d+:\d\d/)
    const list = within(call).getByRole('list', { name: 'Transcripción de la llamada' })
    expect(within(list).getByRole('listitem')).toHaveTextContent(
      '00:00DanielaBuenas tardes, le habla Daniela.',
    )

    vi.mocked(api.postCustomerCallLine).mockResolvedValue({
      turn: makeCustomerTurn({
        sequence: 4,
        kind: 'transcript',
        authorRole: 'customer',
        language: 'es',
        text: 'Hola, veo un cobro raro.',
        createdAt: at(8),
        clientMessageId: 'k-1',
      }),
      call: makeCustomerCall(),
    })
    const input = within(call).getByRole('textbox', { name: 'Lo que dices' })
    await user.type(input, 'Hola, veo un cobro raro.{Enter}')
    expect(api.postCustomerCallLine).toHaveBeenCalledWith(CALL_ID, {
      text: 'Hola, veo un cobro raro.',
      clientMessageId: expect.any(String),
    })
    expect(await within(list).findByText('Hola, veo un cobro raro.')).toBeInTheDocument()
    expect(input).toHaveValue('')

    // "Silenciar" is the customer's microphone, here only.
    const mute = within(call).getByRole('button', { name: 'Silenciar' })
    await user.click(mute)
    expect(mute).toHaveAttribute('aria-pressed', 'true')
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('placeholder', 'Estás en silencio')
    expect(call).toHaveTextContent('En silencio')
    expect(api.commandCustomerCall).not.toHaveBeenCalled()
  })

  it('follows a hold live and hangs up', async () => {
    signInAs(CLAUDIA_ID, { conversation: open(), turns: lines, call: makeCustomerCall() })
    const { user, sockets } = render('call')
    const call = await screen.findByRole('region', { name: 'Llamada con el banco' })
    await within(call).findByText('Te atiende Daniela')
    act(() => sockets.last()?.open())
    act(() =>
      sockets
        .last()
        ?.receive(
          envelope(
            'call.updated',
            makeCustomerCall({ state: 'on_hold', onHold: true }),
            SIM_CASE_ID,
          ),
        ),
    )
    expect(await within(call).findByText('Daniela te puso en espera')).toBeInTheDocument()
    expect(within(call).getByRole('textbox', { name: 'Lo que dices' })).toBeDisabled()

    vi.mocked(api.commandCustomerCall).mockResolvedValue({
      call: makeCustomerCall({
        state: 'ended',
        endedAt: at(252),
        durationSeconds: 252,
        endReason: 'completed',
      }),
      conversation: open(),
      caseCreated: false,
    })
    await user.click(within(call).getByRole('button', { name: 'Colgar' }))
    expect(api.commandCustomerCall).toHaveBeenCalledWith(CALL_ID, 'hangup')
    expect(await within(call).findByText('Llamada terminada, 4 min 12 s')).toBeInTheDocument()
    expect(within(call).getByRole('button', { name: 'Volver a llamar' })).toBeInTheDocument()
    expect(within(call).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('asks for the rating in the call view once the case closed', async () => {
    signInAs(CLAUDIA_ID, {
      conversation: open({ status: 'closed', closedAt: '2026-03-05T17:00:00Z' }),
      turns: lines,
      call: makeCustomerCall({ state: 'ended', durationSeconds: 60, endReason: 'completed' }),
    })
    render('call')
    expect(
      await screen.findByRole('form', { name: '¿Cómo te atendió Daniela?' }),
    ).toBeInTheDocument()
  })

  it('speaks Portuguese to a Brazilian customer', async () => {
    signInAs(SIM_CUSTOMER_ID, {
      conversation: open({ language: 'pt' }),
      call: makeCustomerCall(),
    })
    render('call')
    const call = await screen.findByRole('region', { name: 'Ligação com o banco' })
    expect(call).toHaveAttribute('lang', 'pt-BR')
    expect(await within(call).findByText('Você está falando com Daniela')).toBeInTheDocument()
    expect(within(call).getByRole('button', { name: 'Desligar' })).toBeInTheDocument()
    expect(within(call).getByRole('textbox', { name: 'O que você diz' })).toBeInTheDocument()
  })

  it('rings a call of the bank over the chat: "Contestar" opens the call', async () => {
    const incoming = makeCustomerCall({
      direction: 'outbound',
      state: 'ringing',
      answeredAt: null,
    })
    signInAs(CLAUDIA_ID, { conversation: open({ channel: 'chat_app' }), call: incoming })
    const { user } = render('chat')
    const banner = await screen.findByRole('region', { name: 'LATAM Bank te está llamando' })
    expect(within(banner).getByRole('button', { name: 'Rechazar' })).toBeInTheDocument()
    // The server's answer from now on (the call view refetches it when it opens).
    vi.mocked(api.fetchCustomerCall).mockResolvedValue({
      call: makeCustomerCall({ direction: 'outbound' }),
    })
    vi.mocked(api.commandCustomerCall).mockResolvedValue({
      call: makeCustomerCall({ direction: 'outbound' }),
      conversation: open({ channel: 'chat_app' }),
      caseCreated: false,
    })
    await user.click(within(banner).getByRole('button', { name: 'Contestar' }))
    expect(api.commandCustomerCall).toHaveBeenCalledWith(CALL_ID, 'answer')
    const call = await screen.findByRole('region', { name: 'Llamada con el banco' })
    expect(await within(call).findByText('Te atiende Daniela')).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'LATAM Bank te está llamando' }),
    ).not.toBeInTheDocument()
  })
})

describe('simulator · email (slice 12)', () => {
  it('writes a new email with a subject and shows it in the thread', async () => {
    signInAs(CLAUDIA_ID)
    const { user } = render('email')
    const view = await screen.findByRole('region', { name: 'Nuevo correo' })
    expect(view).toHaveTextContent('Escribe tu consulta.')
    const form = within(view).getByRole('form', { name: 'Escribe tu correo' })
    await user.type(within(form).getByRole('textbox', { name: 'Mensaje' }), 'Hola')
    await user.click(within(form).getByRole('button', { name: 'Enviar' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Escribe el asunto y el mensaje.')
    expect(api.sendCustomerEmail).not.toHaveBeenCalled()

    vi.mocked(api.sendCustomerEmail).mockResolvedValue({
      email: {
        id: 'TRN-E1',
        sequence: 1,
        direction: 'in',
        subject: 'Cobro duplicado',
        body: 'Hola, me cobraron dos veces.',
        authorName: 'Claudia Restrepo Varela',
        createdAt: '2026-03-05T16:00:00Z',
        clientMessageId: 'k',
      },
      conversation: open({ status: 'waiting_agent', agentName: null, channel: 'email' }),
      caseCreated: false,
    })
    await user.type(within(form).getByRole('textbox', { name: 'Asunto' }), 'Cobro duplicado')
    await user.clear(within(form).getByRole('textbox', { name: 'Mensaje' }))
    await user.type(
      within(form).getByRole('textbox', { name: 'Mensaje' }),
      'Hola, me cobraron dos veces.',
    )
    await user.click(within(form).getByRole('button', { name: 'Enviar' }))
    expect(api.sendCustomerEmail).toHaveBeenCalledWith({
      subject: 'Cobro duplicado',
      body: 'Hola, me cobraron dos veces.',
      clientMessageId: expect.any(String),
    })
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Cobro duplicado' }),
    ).toBeInTheDocument()
    const thread = screen.getByRole('list', { name: 'Correos del hilo' })
    expect(within(thread).getByRole('listitem')).toHaveTextContent('Tú')
  })

  it('shows the bank\'s reply as new and answers in the thread with "Re:"', async () => {
    const turns = [
      makeCustomerTurn({
        sequence: 1,
        kind: 'email',
        authorRole: 'customer',
        language: 'es',
        subject: 'Cobro duplicado',
        text: 'Hola, me cobraron dos veces.',
      }),
      makeCustomerTurn({
        sequence: 3,
        kind: 'email',
        authorRole: 'analyst',
        authorName: 'Daniela',
        language: 'es',
        subject: 'Re: Cobro duplicado',
        text: 'Hola, Claudia:\n\n¿Lo hizo en la tienda?\n\nSaludos,\nDaniela Ríos\nLATAM Bank',
      }),
    ]
    signInAs(CLAUDIA_ID, { conversation: open({ channel: 'email' }), turns })
    const { user } = render('email')
    const thread = await screen.findByRole('list', { name: 'Correos del hilo' })
    const [mine, reply] = await within(thread).findAllByRole('listitem')
    expect(within(mine!).getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(reply).toHaveTextContent('Daniela, LATAM Bank')
    expect(reply).toHaveTextContent('Nuevo')
    expect(reply).toHaveTextContent('¿Lo hizo en la tienda?')
    const form = screen.getByRole('form', { name: 'Responder' })
    expect(form).toHaveTextContent('Re: Cobro duplicado')
    expect(within(form).queryByRole('textbox', { name: 'Asunto' })).not.toBeInTheDocument()

    vi.mocked(api.sendCustomerEmail).mockResolvedValue({
      email: {
        id: 'TRN-E4',
        sequence: 4,
        direction: 'in',
        subject: 'Re: Cobro duplicado',
        body: 'Sí, en la tienda.',
        authorName: 'Claudia Restrepo Varela',
        createdAt: '2026-03-05T16:30:00Z',
        clientMessageId: 'k',
      },
      conversation: open({ channel: 'email' }),
      caseCreated: false,
    })
    await user.type(within(form).getByRole('textbox', { name: 'Mensaje' }), 'Sí, en la tienda.')
    await user.click(within(form).getByRole('button', { name: 'Enviar' }))
    expect(api.sendCustomerEmail).toHaveBeenCalledWith({
      subject: 'Re: Cobro duplicado',
      body: 'Sí, en la tienda.',
      clientMessageId: expect.any(String),
    })
    await waitFor(() => expect(within(thread).getAllByRole('listitem')).toHaveLength(3))
    expect(within(thread).queryByText('Nuevo')).not.toBeInTheDocument()
  })
})
