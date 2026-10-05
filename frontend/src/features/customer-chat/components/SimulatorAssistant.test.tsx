import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { customerSessionToken } from '@/lib/session-token'
import {
  demoCustomers,
  envelope,
  fakeCustomerToken,
  makeCustomerConversation,
  makeCustomerTurn,
  SIM_CASE_ID,
} from '@/test/conversation-fixtures'
import { createFakeSocketFactory } from '@/test/fake-socket'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import type { SimChannel } from '../channels'
import type { CustomerConversation, CustomerTurn } from '../types'
import { CustomerSimulatorScreen } from './CustomerSimulatorScreen'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    listDemoCustomers: vi.fn<typeof actual.listDemoCustomers>(),
    fetchCustomerConversation: vi.fn<typeof actual.fetchCustomerConversation>(),
    fetchCustomerCall: vi.fn<typeof actual.fetchCustomerCall>(),
    fetchCustomerPlatform: vi.fn<typeof actual.fetchCustomerPlatform>(),
    startCustomerCall: vi.fn<typeof actual.startCustomerCall>(),
    sendCustomerEmail: vi.fn<typeof actual.sendCustomerEmail>(),
    answerConfirmation: vi.fn<typeof actual.answerConfirmation>(),
    verifyStepUp: vi.fn<typeof actual.verifyStepUp>(),
    requestPerson: vi.fn<typeof actual.requestPerson>(),
  }
})

/** Claudia (es-CO), a seeded simulator customer. */
const CLAUDIA_ID = 'CUS-00000000000000000000001005'

const customerMessage = makeCustomerTurn({
  sequence: 1,
  language: 'es',
  text: 'No reconozco un cargo de 120 dólares',
})
const assistantTurn = makeCustomerTurn({
  sequence: 2,
  language: 'es',
  authorRole: 'assistant',
  authorName: 'Asistente virtual',
  text: 'Hola, Claudia. Soy el asistente virtual de LATAM Bank.',
})

const withAssistant = (assistant: CustomerConversation['assistant'] = null) =>
  makeCustomerConversation({
    status: 'with_assistant',
    language: 'es',
    agentName: 'Asistente virtual',
    assistant: assistant ?? { working: false, confirmation: null, stepUp: null },
  })

function signInAs(conversation: CustomerConversation | null, turns: CustomerTurn[] = []) {
  customerSessionToken.set(fakeCustomerToken(CLAUDIA_ID))
  vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
    conversation,
    turns,
    pastConversationCount: 0,
  })
}

function render(channel: SimChannel | null = 'chat') {
  const sockets = createFakeSocketFactory()
  const view = renderWithProviders(
    <CustomerSimulatorScreen createSocket={sockets.factory} channel={channel} />,
    { route: '/customer' },
  )
  return { ...view, sockets }
}

const problem = (status: number, code: string, extensions?: Record<string, unknown>) =>
  new ApiProblem({ status, code: code as ApiProblem['code'], extensions })

beforeEach(() => {
  vi.mocked(api.listDemoCustomers).mockResolvedValue({ items: demoCustomers })
  vi.mocked(api.fetchCustomerCall).mockResolvedValue({ call: null })
  vi.mocked(api.fetchCustomerPlatform).mockResolvedValue({ aiEnabled: true })
  for (const fn of [
    api.answerConfirmation,
    api.verifyStepUp,
    api.requestPerson,
    api.startCustomerCall,
    api.sendCustomerEmail,
  ]) {
    vi.mocked(fn).mockReset()
  }
})

describe('simulator · the assistant (slice 19)', () => {
  it('shows its turns and "escribiendo…", then hands over to a person on request', async () => {
    signInAs(withAssistant({ working: true, confirmation: null, stepUp: null }), [
      customerMessage,
      assistantTurn,
    ])
    vi.mocked(api.requestPerson).mockResolvedValue(
      makeCustomerConversation({ status: 'waiting_agent', language: 'es' }),
    )
    const { user, sockets } = render()

    expect(await screen.findByText('Te atiende el asistente virtual')).toBeInTheDocument()
    const log = screen.getByRole('log', { name: 'Conversación con soporte' })
    expect(within(log).getByText('Asistente virtual')).toBeInTheDocument()
    expect(within(log).getByText(assistantTurn.text)).toBeInTheDocument()
    expect(screen.getByText('El asistente virtual está escribiendo…')).toBeInTheDocument()
    // No chips while it answers.
    expect(screen.queryByRole('group', { name: 'Sugerencias' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hablar con una persona' }))
    expect(api.requestPerson).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByText('Te estamos pasando con una persona del equipo…'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hablar con una persona' })).not.toBeInTheDocument()
    expect(screen.queryByText('El asistente virtual está escribiendo…')).not.toBeInTheDocument()

    // Then the analyst takes it (live): her name, and the assistant's turns stay.
    const socket = sockets.last()
    act(() => socket?.open())
    act(() =>
      socket?.receive(
        envelope(
          'conversation.updated',
          makeCustomerConversation({ status: 'with_agent', agentName: 'Daniela', language: 'es' }),
          SIM_CASE_ID,
        ),
      ),
    )
    expect(await screen.findByText('Te atiende Daniela, de LATAM Bank')).toBeInTheDocument()
    expect(within(log).getByText(assistantTurn.text)).toBeInTheDocument()
  })

  it('confirms an action with "Sí" and explains an expired confirmation', async () => {
    const confirmation = {
      summary: 'Radicar una disputa por 120 USD',
      token: 'tok-1',
      expiresAt: '2099-01-01T16:05:00Z',
    }
    signInAs(withAssistant({ working: false, confirmation, stepUp: null }), [
      customerMessage,
      assistantTurn,
    ])
    vi.mocked(api.answerConfirmation).mockResolvedValueOnce(
      withAssistant({ working: true, confirmation: null, stepUp: null }),
    )
    const { user } = render()

    const card = await screen.findByRole('region', { name: 'Confirma para seguir' })
    expect(within(card).getByText('Radicar una disputa por 120 USD')).toBeInTheDocument()
    expect(within(card).getByText('Vence a las 11:05')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'No' })).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Sí' }))
    expect(api.answerConfirmation).toHaveBeenCalledWith('tok-1', 'yes')
    expect(await screen.findByText('El asistente virtual está escribiendo…')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Confirma para seguir' })).not.toBeInTheDocument()
  })

  it('refetches after an expired confirmation and says so', async () => {
    const confirmation = {
      summary: 'Bloquear la tarjeta',
      token: 'tok-2',
      expiresAt: '2099-01-01T16:05:00Z',
    }
    signInAs(withAssistant({ working: false, confirmation, stepUp: null }))
    vi.mocked(api.answerConfirmation).mockRejectedValueOnce(problem(409, 'confirmation_expired'))
    const { user } = render()

    const card = await screen.findByRole('region', { name: 'Confirma para seguir' })
    const fetches = vi.mocked(api.fetchCustomerConversation).mock.calls.length
    await user.click(within(card).getByRole('button', { name: 'No' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'La confirmación venció. Escribe de nuevo lo que necesitas.',
    )
    await waitFor(() =>
      expect(vi.mocked(api.fetchCustomerConversation).mock.calls.length).toBeGreaterThan(fetches),
    )
  })

  it('asks for the simulated code, counts wrong attempts and follows the third one', async () => {
    signInAs(
      withAssistant({
        working: false,
        confirmation: null,
        stepUp: { reason: 'requires_step_up', simulated: true },
      }),
    )
    vi.mocked(api.verifyStepUp)
      .mockRejectedValueOnce(problem(422, 'invalid_step_up_code', { remainingAttempts: 2 }))
      .mockRejectedValueOnce(problem(422, 'invalid_step_up_code', { remainingAttempts: 0 }))
    const { user } = render()

    const form = await screen.findByRole('form', { name: 'Confirma que eres tú' })
    expect(within(form).getByText('Código simulado de desarrollo: 000000')).toBeInTheDocument()
    const input = within(form).getByRole('textbox', { name: 'Código de verificación' })
    await user.type(input, '12a3456')
    expect(input).toHaveValue('123456')
    await user.click(within(form).getByRole('button', { name: 'Verificar' }))
    expect(api.verifyStepUp).toHaveBeenCalledWith('123456')
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Código incorrecto. Te quedan 2 intentos.',
    )
    expect(input).toHaveValue('')

    // The third wrong code hands the conversation to people: the chat refetches and follows.
    vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
      conversation: makeCustomerConversation({ status: 'waiting_agent', language: 'es' }),
      turns: [customerMessage, assistantTurn],
      pastConversationCount: 0,
    })
    await user.type(input, '999999')
    await user.click(within(form).getByRole('button', { name: 'Verificar' }))
    expect(
      await screen.findByText('Te estamos pasando con una persona del equipo…'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Confirma que eres tú' })).not.toBeInTheDocument()
  })

  it('says when people already have the conversation', async () => {
    signInAs(withAssistant())
    vi.mocked(api.requestPerson).mockRejectedValueOnce(problem(409, 'assistant_not_active'))
    const { user } = render()
    await user.click(await screen.findByRole('button', { name: 'Hablar con una persona' }))
    expect(
      await screen.findByText('Una persona del equipo ya tiene tu conversación.'),
    ).toHaveAttribute('role', 'alert')
  })

  it('asks how the assistant did when it resolved the conversation', async () => {
    signInAs(
      makeCustomerConversation({
        status: 'closed',
        language: 'es',
        agentName: 'Asistente virtual',
        closedAt: '2026-03-05T16:10:00Z',
      }),
      [customerMessage, assistantTurn],
    )
    render()
    expect(
      await screen.findByRole('form', { name: '¿Cómo te atendió el asistente virtual?' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hablar con una persona' })).not.toBeInTheDocument()
  })

  it('offers a person when a call cannot join the assistant conversation', async () => {
    signInAs(withAssistant())
    vi.mocked(api.startCustomerCall).mockRejectedValueOnce(problem(409, 'assistant_active'))
    vi.mocked(api.requestPerson).mockResolvedValue(
      makeCustomerConversation({ status: 'waiting_agent', language: 'es' }),
    )
    const { user } = render(null)
    const picker = await screen.findByRole('region', {
      name: '¿Cómo se comunica Claudia con el banco?',
    })
    await user.click(within(picker).getByRole('button', { name: /^Llamar/ }))
    const message =
      'El asistente virtual te está atendiendo por chat. Escríbele por ahí o pide hablar con una persona.'
    expect(await screen.findByText(message)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hablar con una persona' }))
    expect(api.requestPerson).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText(message)).not.toBeInTheDocument())
  })
})
