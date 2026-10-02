import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { customerSessionToken, sessionToken } from '@/lib/session-token'
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
import { renderRoute, renderWithProviders } from '@/test/render'
import * as api from '../api'
import type { PostCustomerTurnResponse } from '../types'
import { CustomerSimulatorScreen } from './CustomerSimulatorScreen'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    listDemoCustomers: vi.fn<typeof actual.listDemoCustomers>(),
    createCustomerSession: vi.fn<typeof actual.createCustomerSession>(),
    fetchCustomerConversation: vi.fn<typeof actual.fetchCustomerConversation>(),
    postCustomerTurn: vi.fn<typeof actual.postCustomerTurn>(),
  }
})

const token = () => fakeCustomerToken(SIM_CUSTOMER_ID)

function renderSimulator() {
  const customerSockets = createFakeSocketFactory()
  const view = renderWithProviders(
    <CustomerSimulatorScreen createSocket={customerSockets.factory} />,
    {
      route: '/cliente',
    },
  )
  return { ...view, customerSockets }
}

beforeEach(() => {
  vi.mocked(api.listDemoCustomers).mockResolvedValue({ items: demoCustomers })
  vi.mocked(api.fetchCustomerConversation).mockResolvedValue({ conversation: null, turns: [] })
})

describe('CustomerSimulatorScreen · picker', () => {
  it('lists the sample customers and opens a session for the one picked', async () => {
    const issued = token()
    vi.mocked(api.createCustomerSession).mockResolvedValue({
      token: issued,
      expiresAt: '2026-03-06T00:00:00Z',
      customer: {
        id: SIM_CUSTOMER_ID,
        displayName: 'Rafael Nogueira Costa',
        locale: 'pt-BR',
        language: 'pt',
      },
      channel: 'app_chat',
    })
    const { user } = renderSimulator()

    expect(screen.getByRole('heading', { name: 'Simulador de cliente' })).toBeInTheDocument()
    expect(screen.getByText('Herramienta de desarrollo')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Elige un cliente de ejemplo' })).toBeInTheDocument()
    expect(screen.getByText('Datos de ejemplo')).toBeInTheDocument()
    const joaquin = await screen.findByRole('button', { name: /Joaquín Ferreyra Paz/ })
    expect(within(joaquin).getByText('Conversación abierta')).toBeInTheDocument()
    const rafael = screen.getByRole('button', { name: /Rafael Nogueira Costa/ })
    expect(within(rafael).getByText('Portugués de Brasil')).toBeInTheDocument()
    expect(within(rafael).getByText('Buenos Aires, Argentina · Plus')).toBeInTheDocument()

    await user.click(rafael)
    expect(api.createCustomerSession).toHaveBeenCalledWith({ customerId: SIM_CUSTOMER_ID })
    expect(await screen.findByText('Soporte')).toBeInTheDocument()
    expect(customerSessionToken.get()).toBe(issued)
    // The staff session is untouched.
    expect(sessionToken.get()).toBeNull()
  })

  it('explains a failed sign-in', async () => {
    vi.mocked(api.createCustomerSession).mockRejectedValue(
      new ApiProblem({ status: 404, code: 'not_found' }),
    )
    const { user } = renderSimulator()
    await user.click(await screen.findByRole('button', { name: /Rafael Nogueira Costa/ }))
    expect(await screen.findByText(/Ese cliente ya no está disponible/)).toBeInTheDocument()
  })

  it('shows an empty state when the backend has no sample data', async () => {
    vi.mocked(api.listDemoCustomers).mockResolvedValue({ items: [] })
    renderSimulator()
    expect(await screen.findByText('No hay clientes de ejemplo')).toBeInTheDocument()
  })
})

describe('CustomerSimulatorScreen · chat', () => {
  it('restores the session after a reload and chats live over its own socket', async () => {
    const stored = token()
    customerSessionToken.set(stored)
    let resolvePost!: (value: PostCustomerTurnResponse) => void
    vi.mocked(api.postCustomerTurn).mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve
      }),
    )
    const { user, customerSockets } = renderSimulator()

    expect(await screen.findByText('Hablando como')).toBeInTheDocument()
    expect(
      await screen.findByText(/Escribe tu mensaje y te responde una persona/),
    ).toBeInTheDocument()

    const socket = customerSockets.last()
    expect(socket?.url).toContain(encodeURIComponent(stored))
    act(() => socket?.open())
    expect(socket?.messages()).toContainEqual({
      action: 'subscribe',
      topic: `customer:${SIM_CUSTOMER_ID}`,
    })

    // Opener chip prefills the input.
    await user.click(
      await screen.findByRole('button', { name: 'Olá, não reconheço uma compra no meu cartão' }),
    )
    const input = screen.getByRole('textbox', { name: 'Escribe tu mensaje' })
    expect(input).toHaveValue('Olá, não reconheço uma compra no meu cartão')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(input).toHaveValue('')
    // Sending with the button keeps the keyboard focus in the chat.
    expect(input).toHaveFocus()
    expect(screen.getByText('Enviando…')).toBeInTheDocument()
    // No chips while a message is on its way.
    expect(screen.queryByRole('group', { name: 'Sugerencias' })).not.toBeInTheDocument()

    const body = vi.mocked(api.postCustomerTurn).mock.calls[0]![0]
    const turn = makeCustomerTurn({
      sequence: 1,
      clientMessageId: body.clientMessageId,
      text: body.text,
    })
    await act(async () =>
      resolvePost({ turn, conversation: makeCustomerConversation(), caseCreated: true }),
    )
    expect(await screen.findByText('Buscando a una persona del equipo…')).toBeInTheDocument()
    expect(screen.queryByText('Enviando…')).not.toBeInTheDocument()

    // Echo + server notice + the analyst's reply, live.
    act(() => {
      socket?.receive(envelope('turn.created', turn, SIM_CASE_ID))
      socket?.receive(
        envelope(
          'turn.created',
          makeCustomerTurn({
            sequence: 2,
            kind: 'notice',
            authorRole: 'system',
            text: 'Recebemos sua mensagem.',
          }),
          SIM_CASE_ID,
        ),
      )
      socket?.receive(
        envelope(
          'conversation.updated',
          makeCustomerConversation({ status: 'with_agent', agentName: 'Daniela' }),
          SIM_CASE_ID,
        ),
      )
      socket?.receive(
        envelope(
          'turn.created',
          makeCustomerTurn({
            sequence: 4,
            authorRole: 'analyst',
            authorName: 'Daniela',
            text: 'Olá, Rafael! Vou verificar.',
          }),
          SIM_CASE_ID,
        ),
      )
    })
    expect(await screen.findByText('Olá, Rafael! Vou verificar.')).toBeInTheDocument()
    expect(screen.getByText('Daniela · LATAM Bank')).toBeInTheDocument()
    expect(screen.getByText('Te atiende Daniela · LATAM Bank')).toBeInTheDocument()
    expect(screen.getByText('Recebemos sua mensagem.')).toBeInTheDocument()
    // POST response + echo = one bubble; the chip already sent is not offered again.
    expect(screen.getAllByText('Olá, não reconheço uma compra no meu cartão')).toHaveLength(1)
    const chips = screen.getByRole('group', { name: 'Sugerencias' })
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Quero falar com uma pessoa'])
    // Chips sit outside the live log: only messages are announced.
    expect(within(screen.getByRole('log')).queryByRole('group')).not.toBeInTheDocument()
  })

  it("offers an open chat's follow-up chips (Joaquín, with_agent)", async () => {
    const joaquin = 'CUS-00000000000000000000001007'
    customerSessionToken.set(fakeCustomerToken(joaquin))
    vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
      conversation: makeCustomerConversation({
        caseId: 'CASE-00000000000000000000000107',
        status: 'with_agent',
        agentName: 'Daniela',
        language: 'es',
      }),
      turns: [
        makeCustomerTurn({ sequence: 1, language: 'es', text: 'Tengo un cargo que no reconozco' }),
        makeCustomerTurn({
          sequence: 2,
          language: 'es',
          authorRole: 'analyst',
          authorName: 'Daniela',
          text: '¿Me contás cuándo fue y de cuánto?',
        }),
      ],
    })
    const { user } = renderSimulator()
    expect(await screen.findByText('Te atiende Daniela · LATAM Bank')).toBeInTheDocument()
    await user.click(
      await screen.findByRole('button', { name: 'Fue a mediados de mes, unos $48.300' }),
    )
    expect(screen.getByRole('textbox', { name: 'Escribe tu mensaje' })).toHaveValue(
      'Fue a mediados de mes, unos $48.300',
    )
    expect(screen.getByRole('button', { name: '¿Lo pudiste encontrar?' })).toBeInTheDocument()
  })

  it('mounts the live log with the history in it and keeps the bubble from sending to sent', async () => {
    customerSessionToken.set(token())
    let resolvePost!: (value: PostCustomerTurnResponse) => void
    vi.mocked(api.postCustomerTurn).mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve
      }),
    )
    vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
      conversation: makeCustomerConversation(),
      turns: [makeCustomerTurn({ sequence: 1 })],
    })
    const { user } = renderSimulator()
    // No log while loading (the skeleton is not announced), then one with the history.
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
    const log = await screen.findByRole('log', { name: 'Conversación con soporte' })
    expect(log).toHaveAttribute('aria-relevant', 'additions')
    expect(within(log).getByText('Olá, não reconheço uma compra no meu cartão')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Escribe tu mensaje' }), 'oi{Enter}')
    const sending = within(log).getByText('oi').closest('li')
    const body = vi.mocked(api.postCustomerTurn).mock.calls[0]![0]
    await act(async () =>
      resolvePost({
        turn: makeCustomerTurn({ sequence: 3, text: 'oi', clientMessageId: body.clientMessageId }),
        conversation: makeCustomerConversation(),
        caseCreated: false,
      }),
    )
    await waitFor(() => expect(screen.queryByText('Enviando…')).not.toBeInTheDocument())
    // Same DOM node: the bubble was updated in place, not remounted (announced once).
    expect(within(log).getByText('oi').closest('li')).toBe(sending)
  })

  it('posts quick messages one after another, in the order they were typed', async () => {
    customerSessionToken.set(token())
    const resolvers: Array<(value: PostCustomerTurnResponse) => void> = []
    vi.mocked(api.postCustomerTurn).mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    )
    const { user } = renderSimulator()
    const input = await screen.findByRole('textbox', { name: 'Escribe tu mensaje' })
    await user.type(input, 'hola?{Enter}')
    await user.type(input, 'hola??{Enter}')
    await user.type(input, 'contesten!!{Enter}')
    // Only the first POST is in flight; the others wait their turn.
    expect(api.postCustomerTurn).toHaveBeenCalledTimes(1)
    for (const [index, text] of ['hola?', 'hola??', 'contesten!!'].entries()) {
      await waitFor(() => expect(api.postCustomerTurn).toHaveBeenCalledTimes(index + 1))
      const body = vi.mocked(api.postCustomerTurn).mock.calls[index]![0]
      expect(body.text).toBe(text)
      await act(async () =>
        resolvers[index]!({
          turn: makeCustomerTurn({
            sequence: index + 1,
            text,
            clientMessageId: body.clientMessageId,
          }),
          conversation: makeCustomerConversation(),
          caseCreated: index === 0,
        }),
      )
    }
    await waitFor(() => expect(screen.queryByText('Enviando…')).not.toBeInTheDocument())
  })

  it('retries a failed message with the same clientMessageId', async () => {
    customerSessionToken.set(token())
    vi.mocked(api.postCustomerTurn).mockRejectedValueOnce(ApiProblem.network())
    const { user } = renderSimulator()
    const input = await screen.findByRole('textbox', { name: 'Escribe tu mensaje' })
    await user.type(input, 'Quero falar com uma pessoa{Enter}')
    expect(await screen.findByText(/No se envió/)).toBeInTheDocument()

    const firstId = vi.mocked(api.postCustomerTurn).mock.calls[0]![0].clientMessageId
    vi.mocked(api.postCustomerTurn).mockResolvedValueOnce({
      turn: makeCustomerTurn({
        sequence: 1,
        clientMessageId: firstId,
        text: 'Quero falar com uma pessoa',
      }),
      conversation: makeCustomerConversation(),
      caseCreated: true,
    })
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(screen.queryByText(/No se envió/)).not.toBeInTheDocument())
    expect(vi.mocked(api.postCustomerTurn).mock.calls[1]![0].clientMessageId).toBe(firstId)
    expect(screen.getAllByText('Quero falar com uma pessoa')).toHaveLength(1)
  })

  it('shows an ended conversation and goes back to the picker on "Cambiar de cliente"', async () => {
    customerSessionToken.set(token())
    vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
      conversation: makeCustomerConversation({
        status: 'closed',
        closedAt: '2026-03-05T17:00:00Z',
      }),
      turns: [
        makeCustomerTurn({ sequence: 1 }),
        makeCustomerTurn({
          sequence: 9,
          kind: 'notice',
          authorRole: 'system',
          text: 'A conversa foi encerrada. Obrigado por falar com o LATAM Bank.',
        }),
      ],
    })
    const { user } = renderSimulator()
    expect(await screen.findByText('Conversación terminada')).toBeInTheDocument()
    expect(screen.getByText(/A conversa foi encerrada/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cambiar de cliente' }))
    expect(
      await screen.findByRole('heading', { name: 'Elige un cliente de ejemplo' }),
    ).toBeInTheDocument()
    expect(customerSessionToken.get()).toBeNull()
  })

  it('drops an expired stored token', async () => {
    customerSessionToken.set(fakeCustomerToken(SIM_CUSTOMER_ID, { expiresInSeconds: -60 }))
    renderSimulator()
    expect(
      await screen.findByRole('heading', { name: 'Elige un cliente de ejemplo' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(customerSessionToken.get()).toBeNull())
  })
})

describe('/cliente route', () => {
  it('renders the simulator outside the staff shell, without a staff session', async () => {
    renderRoute('/cliente')
    expect(await screen.findByRole('heading', { name: 'Simulador de cliente' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Rafael Nogueira Costa/ })).toBeInTheDocument()
  })
})
