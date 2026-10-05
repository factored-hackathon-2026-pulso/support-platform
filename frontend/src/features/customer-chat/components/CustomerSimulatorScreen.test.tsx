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
  makePastSummary,
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
    fetchCustomerCall: vi.fn<typeof actual.fetchCustomerCall>(),
    createCustomerSession: vi.fn<typeof actual.createCustomerSession>(),
    fetchCustomerConversation: vi.fn<typeof actual.fetchCustomerConversation>(),
    postCustomerTurn: vi.fn<typeof actual.postCustomerTurn>(),
    listPastConversations: vi.fn<typeof actual.listPastConversations>(),
    fetchPastConversation: vi.fn<typeof actual.fetchPastConversation>(),
    fetchCustomerPlatform: vi.fn<typeof actual.fetchCustomerPlatform>(),
  }
})

const token = () => fakeCustomerToken(SIM_CUSTOMER_ID)

function renderSimulator() {
  const customerSockets = createFakeSocketFactory()
  const view = renderWithProviders(
    <CustomerSimulatorScreen createSocket={customerSockets.factory} channel="chat" />,
    {
      route: '/customer',
    },
  )
  return { ...view, customerSockets }
}

beforeEach(() => {
  vi.mocked(api.fetchCustomerPlatform).mockResolvedValue({ aiEnabled: false })
  vi.mocked(api.fetchCustomerCall).mockResolvedValue({ call: null })
  vi.mocked(api.listDemoCustomers).mockResolvedValue({ items: demoCustomers })
  vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
    conversation: null,
    turns: [],
    pastConversationCount: 0,
  })
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
      channel: 'chat_app',
    })
    const { user } = renderSimulator()

    expect(screen.getByRole('heading', { name: 'Simulador de cliente' })).toBeInTheDocument()
    expect(screen.getByText('Herramienta de desarrollo')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Elige un cliente de ejemplo' })).toBeInTheDocument()
    expect(screen.queryByText('Datos de ejemplo')).not.toBeInTheDocument()
    const joaquin = await screen.findByRole('button', { name: /Joaquín Ferreyra Paz/ })
    expect(within(joaquin).getByText('Conversación abierta')).toBeInTheDocument()
    const rafael = screen.getByRole('button', { name: /Rafael Nogueira Costa/ })
    // pt-BR shows the PT language mark (globe + PT), named by the locale.
    expect(
      within(rafael).getByText('Portugués de Brasil', { selector: '.sr-only' }),
    ).toBeInTheDocument()
    expect(rafael).toHaveTextContent(/PT/)
    expect(rafael.querySelector('[data-languages="pt"] svg.lucide-globe')).not.toBeNull()
    expect(within(rafael).getByText('Buenos Aires, Argentina')).toBeInTheDocument()
    expect(rafael).not.toHaveTextContent(/conversaci(ó|o)n(es)? anterior/)
    const claudia = screen.getByRole('button', { name: /Claudia Restrepo Varela/ })
    expect(within(claudia).getByText('1 conversación anterior')).toBeInTheDocument()
    const gabriela = screen.getByRole('button', { name: /Gabriela Duarte Melo/ })
    expect(within(gabriela).getByText('Esperando a una persona')).toBeInTheDocument()

    await user.click(rafael)
    expect(api.createCustomerSession).toHaveBeenCalledWith({ customerId: SIM_CUSTOMER_ID })
    // Slice 12: then how the customer reaches the bank.
    expect(
      await screen.findByRole('heading', { name: '¿Cómo se comunica Rafael con el banco?' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Chat/ }))
    expect(await screen.findByText('Suporte')).toBeInTheDocument()
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
      await screen.findByText('Portugués de Brasil', { selector: '.sr-only' }),
    ).toBeInTheDocument()
    // Rafael (pt-BR): the chat speaks Portuguese; the simulator chrome stays in Spanish.
    const status = await screen.findByText(/Escreva sua mensagem e uma pessoa da equipe/)
    expect(status.closest('[lang]')).toHaveAttribute('lang', 'pt-BR')
    expect(screen.getByText('Suporte')).toBeInTheDocument()
    expect(screen.getByText('Olá, como podemos ajudar?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cambiar de cliente' })).toBeInTheDocument()

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
    const input = screen.getByRole('textbox', { name: 'Escreva sua mensagem' })
    expect(input).toHaveValue('Olá, não reconheço uma compra no meu cartão')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(input).toHaveValue('')
    // Sending with the button keeps the keyboard focus in the chat.
    expect(input).toHaveFocus()
    expect(screen.getByText('Enviando…')).toBeInTheDocument()
    // No chips while a message is on its way.
    expect(screen.queryByRole('group', { name: 'Sugestões' })).not.toBeInTheDocument()

    const body = vi.mocked(api.postCustomerTurn).mock.calls[0]![0]
    const turn = makeCustomerTurn({
      sequence: 1,
      clientMessageId: body.clientMessageId,
      text: body.text,
    })
    await act(async () =>
      resolvePost({ turn, conversation: makeCustomerConversation(), caseCreated: true }),
    )
    expect(await screen.findByText('Procurando uma pessoa da equipe…')).toBeInTheDocument()
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
    expect(screen.getByText('Daniela, do LATAM Bank')).toBeInTheDocument()
    expect(screen.getByText('Você está falando com Daniela, do LATAM Bank')).toBeInTheDocument()
    expect(screen.getByText('Recebemos sua mensagem.')).toBeInTheDocument()
    // POST response + echo = one bubble; the chip already sent is not offered again.
    expect(screen.getAllByText('Olá, não reconheço uma compra no meu cartão')).toHaveLength(1)
    const chips = screen.getByRole('group', { name: 'Sugestões' })
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
      pastConversationCount: 0,
    })
    const { user } = renderSimulator()
    expect(await screen.findByText('Te atiende Daniela, de LATAM Bank')).toBeInTheDocument()
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
      pastConversationCount: 0,
    })
    const { user } = renderSimulator()
    // No log while loading (the skeleton is not announced), then one with the history.
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
    const log = await screen.findByRole('log', { name: 'Conversa com o suporte' })
    expect(log).toHaveAttribute('aria-relevant', 'additions')
    expect(within(log).getByText('Olá, não reconheço uma compra no meu cartão')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Escreva sua mensagem' }), 'oi{Enter}')
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
    const input = await screen.findByRole('textbox', { name: 'Escreva sua mensagem' })
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
    const input = await screen.findByRole('textbox', { name: 'Escreva sua mensagem' })
    await user.type(input, 'Quero falar com uma pessoa{Enter}')
    expect(await screen.findByText(/Não enviada/)).toBeInTheDocument()

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
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(screen.queryByText(/Não enviada/)).not.toBeInTheDocument())
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
      pastConversationCount: 0,
    })
    const { user } = renderSimulator()
    expect(await screen.findByText('Conversa encerrada')).toBeInTheDocument()
    expect(screen.getByText(/A conversa foi encerrada/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cambiar de cliente' }))
    expect(
      await screen.findByRole('heading', { name: 'Elige un cliente de ejemplo' }),
    ).toBeInTheDocument()
    expect(customerSessionToken.get()).toBeNull()
  })

  it('shows past conversations on demand, oldest at the top, and opens one read-only', async () => {
    const claudia = 'CUS-00000000000000000000001005'
    customerSessionToken.set(fakeCustomerToken(claudia))
    vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
      conversation: makeCustomerConversation({
        caseId: 'CASE-00000000000000000000009100',
        status: 'with_agent',
        agentName: 'Daniela',
        language: 'es',
      }),
      turns: [makeCustomerTurn({ sequence: 1, language: 'es', text: 'Hola de nuevo' })],
      pastConversationCount: 2,
    })
    vi.mocked(api.listPastConversations).mockResolvedValue({
      items: [
        makePastSummary(),
        makePastSummary({
          caseId: 'CASE-00000000000000000000000099',
          openedAt: '2026-02-10T13:00:00Z',
          agentName: 'Julián',
          preview: 'Gracias, ya quedó.',
        }),
      ],
    })
    vi.mocked(api.fetchPastConversation).mockResolvedValue({
      conversation: makeCustomerConversation({
        caseId: 'CASE-00000000000000000000000105',
        status: 'closed',
        agentName: 'Daniela',
        language: 'es',
      }),
      turns: [
        makeCustomerTurn({
          sequence: 1,
          language: 'es',
          text: 'Hola, necesito ayuda con un cargo',
        }),
        makeCustomerTurn({
          sequence: 4,
          language: 'es',
          authorRole: 'analyst',
          authorName: 'Daniela',
          text: '¿Me cuenta qué cargo es y de qué fecha?',
        }),
      ],
    })
    const { user } = renderSimulator()
    const button = await screen.findByRole('button', {
      name: 'Ver conversaciones anteriores (2)',
    })
    expect(api.listPastConversations).not.toHaveBeenCalled()
    await user.click(button)

    const past = await screen.findByRole('region', { name: 'Conversaciones anteriores' })
    const blocks = within(past).getAllByRole('button', { expanded: false })
    // The button is gone: the focus moves to the first loaded block, not to <body>.
    expect(blocks[0]).toHaveFocus()
    expect(blocks.map((block) => block.textContent)).toEqual([
      'Conversación del 10 feb 2026Te atendió JuliánGracias, ya quedó.',
      'Conversación del 4 mar 2026Te atendió DanielaHola, Claudia. Soy Daniela, de LATAM Bank. ¿Me cuenta qué cargo es y de qué fecha?',
    ])
    // Past conversations sit outside the live log.
    expect(screen.getByRole('log')).not.toContainElement(past)

    await user.click(blocks[1]!)
    expect(blocks[1]).toHaveAttribute('aria-expanded', 'true')
    expect(await within(past).findByText('Hola, necesito ayuda con un cargo')).toBeInTheDocument()
    expect(api.fetchPastConversation).toHaveBeenCalledWith(
      'CASE-00000000000000000000000105',
      expect.anything(),
    )
    expect(
      screen.queryByRole('button', { name: /Ver conversaciones anteriores/ }),
    ).not.toBeInTheDocument()
  })

  it('writing after a close starts a new conversation and keeps the closed one above', async () => {
    customerSessionToken.set(token())
    vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
      conversation: makeCustomerConversation({
        status: 'closed',
        agentName: 'Daniela',
        closedAt: '2026-03-05T17:00:00Z',
      }),
      turns: [
        makeCustomerTurn({ sequence: 1 }),
        makeCustomerTurn({
          sequence: 6,
          kind: 'notice',
          authorRole: 'system',
          text: 'A conversa foi encerrada. Se precisar de algo mais, escreva para nós e abrimos uma nova conversa.',
        }),
      ],
      pastConversationCount: 0,
    })
    const next = makeCustomerConversation({
      caseId: 'CASE-00000000000000000000009002',
      openedAt: '2026-03-05T17:30:00Z',
      previousCaseId: SIM_CASE_ID,
      lastSequence: 1,
    })
    vi.mocked(api.postCustomerTurn).mockImplementation(async (body) => ({
      turn: makeCustomerTurn({
        id: 'TRN-NEW-1',
        sequence: 1,
        text: body.text,
        clientMessageId: body.clientMessageId,
      }),
      conversation: next,
      caseCreated: true,
    }))
    const { user } = renderSimulator()
    expect(await screen.findByText('Conversa encerrada')).toBeInTheDocument()
    // Slice 7: an unrated closed conversation asks first; "Agora não" brings the composer.
    await user.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(
      screen.getByText('Esta conversa terminou. Se você escrever, começamos uma nova.'),
    ).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'Escreva sua mensagem' })
    expect(input).toBeEnabled()
    expect(input).toHaveAttribute('placeholder', 'Escreva para começar uma nova conversa')

    // The next refetch answers with the new conversation.
    vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
      conversation: next,
      turns: [makeCustomerTurn({ id: 'TRN-NEW-1', sequence: 1, text: 'Oi de novo' })],
      pastConversationCount: 1,
    })
    await user.type(input, 'Oi de novo{Enter}')

    expect(await screen.findByText('Procurando uma pessoa da equipe…')).toBeInTheDocument()
    const past = screen.getByRole('region', { name: 'Conversas anteriores' })
    const block = within(past).getByRole('button', { expanded: true })
    expect(block).toHaveTextContent('Atendida por Daniela')
    expect(within(past).getByText(/A conversa foi encerrada/)).toBeInTheDocument()
    const log = screen.getByRole('log', { name: 'Conversa com o suporte' })
    expect(within(log).getByText('Oi de novo')).toBeInTheDocument()
    expect(within(log).queryByText(/A conversa foi encerrada/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('Esta conversa terminou. Se você escrever, começamos uma nova.'),
    ).not.toBeInTheDocument()
    // Already on screen: no "Ver conversaciones anteriores" for it.
    expect(
      screen.queryByRole('button', { name: /Ver conversas anteriores/ }),
    ).not.toBeInTheDocument()
  })

  it('follows the AI switch live on its own socket (slice 18)', async () => {
    customerSessionToken.set(token())
    vi.mocked(api.fetchCustomerPlatform).mockResolvedValue({ aiEnabled: true })
    const { customerSockets, container } = renderSimulator()
    expect(await screen.findByText('Hablando como')).toBeInTheDocument()
    const socket = customerSockets.last()
    act(() => socket?.open())
    expect(socket?.messages()).toContainEqual({ action: 'subscribe', topic: 'platform:settings' })
    const root = () => container.querySelector('[data-ai-enabled]')
    await waitFor(() => expect(root()).toHaveAttribute('data-ai-enabled', 'true'))
    act(() => socket?.receive(envelope('platform.updated', { aiEnabled: false })))
    await waitFor(() => expect(root()).toHaveAttribute('data-ai-enabled', 'false'))
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

describe('/customer route', () => {
  it('renders the simulator outside the staff shell, without a staff session', async () => {
    renderRoute('/customer')
    expect(await screen.findByRole('heading', { name: 'Simulador de cliente' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Rafael Nogueira Costa/ })).toBeInTheDocument()
  })
})
