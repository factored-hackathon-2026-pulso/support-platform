import { act, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { customerSessionToken } from '@/lib/session-token'
import {
  demoCustomers,
  fakeCustomerToken,
  makeCustomerConversation,
  makeCustomerTurn,
  SIM_CUSTOMER_ID,
} from '@/test/conversation-fixtures'
import { createFakeSocketFactory } from '@/test/fake-socket'
import { renderRoute, renderWithProviders, setTestLocale } from '@/test/render'
import type { AppLocale } from '@/lib/i18n'
import * as api from '../api'
import type { SimChannel } from '../channels'
import type { CustomerConversation, CustomerTurn } from '../types'
import { CustomerSimulatorScreen } from './CustomerSimulatorScreen'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    listDemoCustomers: vi.fn<typeof actual.listDemoCustomers>(),
    createCustomerSession: vi.fn<typeof actual.createCustomerSession>(),
    fetchCustomerConversation: vi.fn<typeof actual.fetchCustomerConversation>(),
    fetchCustomerCall: vi.fn<typeof actual.fetchCustomerCall>(),
    fetchCustomerPlatform: vi.fn<typeof actual.fetchCustomerPlatform>(),
    startCustomerCall: vi.fn<typeof actual.startCustomerCall>(),
  }
})

/** Claudia (es-CO), a Spanish-speaking seeded customer; Rafael (pt-BR) is `SIM_CUSTOMER_ID`. */
const CLAUDIA_ID = 'CUS-00000000000000000000001005'

function signInAs(
  customerId: string,
  {
    conversation = null,
    turns = [],
  }: { conversation?: CustomerConversation | null; turns?: CustomerTurn[] } = {},
) {
  customerSessionToken.set(fakeCustomerToken(customerId))
  vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
    conversation,
    turns,
    pastConversationCount: 0,
  })
}

function render(channel: SimChannel | null, locale: AppLocale) {
  const sockets = createFakeSocketFactory()
  return renderWithProviders(
    <CustomerSimulatorScreen createSocket={sockets.factory} channel={channel} />,
    { route: '/customer', locale },
  )
}

beforeEach(() => {
  vi.mocked(api.listDemoCustomers).mockResolvedValue({ items: demoCustomers })
  vi.mocked(api.fetchCustomerPlatform).mockResolvedValue({ aiEnabled: false })
  vi.mocked(api.fetchCustomerCall).mockResolvedValue({ call: null })
  vi.mocked(api.startCustomerCall).mockReset()
})

describe('/customer in Portuguese (slice 23)', () => {
  it('shows the picker chrome in the UI language and explains a failed sign-in', async () => {
    vi.mocked(api.createCustomerSession).mockRejectedValue(
      new ApiProblem({ status: 404, code: 'not_found' }),
    )
    const { user } = renderRoute('/customer', { locale: 'pt-BR' })

    expect(await screen.findByRole('heading', { name: 'Simulador de cliente' })).toBeInTheDocument()
    expect(screen.getByText('Ferramenta de desenvolvimento')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Escolha um cliente de exemplo' }),
    ).toBeInTheDocument()
    const joaquin = await screen.findByRole('button', { name: /Joaquín Ferreyra Paz/ })
    expect(within(joaquin).getByText('Conversa aberta')).toBeInTheDocument()
    expect(
      within(joaquin).getByText('Espanhol da Argentina', { selector: '.sr-only' }),
    ).toBeInTheDocument()
    expect(within(joaquin).getByText('Rosario, Argentina')).toBeInTheDocument()
    const claudia = screen.getByRole('button', { name: /Claudia Restrepo Varela/ })
    expect(within(claudia).getByText('1 conversa anterior')).toBeInTheDocument()
    expect(within(claudia).getByText('Barranquilla, Colômbia')).toBeInTheDocument()
    const gabriela = screen.getByRole('button', { name: /Gabriela Duarte Melo/ })
    expect(within(gabriela).getByText('Aguardando uma pessoa')).toBeInTheDocument()
    expect(
      within(gabriela).getByText('Português do Brasil', { selector: '.sr-only' }),
    ).toBeInTheDocument()

    await user.click(claudia)
    expect(await screen.findByText('A sessão não foi aberta')).toBeInTheDocument()
    expect(
      screen.getByText('Esse cliente não está mais disponível para o simulador. Escolha outro.'),
    ).toBeInTheDocument()
  })

  it('keeps the chrome in Portuguese and the phone in the Spanish customer’s language', async () => {
    signInAs(CLAUDIA_ID)
    const { user } = render(null, 'pt-BR')

    expect(await screen.findByText('Falando como')).toBeInTheDocument()
    const picker = await screen.findByRole('region', {
      name: 'Como Claudia entra em contato com o banco?',
    })
    expect(
      within(picker)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'ChatEscreva pelo app',
      'LigarFale com uma pessoa',
      'Enviar um e-mailA resposta chega por e-mail',
    ])
    expect(screen.getByRole('button', { name: 'Trocar de cliente' })).toBeInTheDocument()

    await user.click(within(picker).getByRole('button', { name: /^Chat/ }))
    // The phone frame speaks Claudia's Spanish, whatever the UI language is.
    expect(await screen.findByText('Soporte')).toBeInTheDocument()
    expect(screen.getByText('Hola, ¿en qué te podemos ayudar?')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Escribe tu mensaje' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trocar de canal' })).toBeInTheDocument()
  })

  it('says why a call could not start in the UI language', async () => {
    signInAs(CLAUDIA_ID)
    vi.mocked(api.startCustomerCall).mockRejectedValue(
      new ApiProblem({ status: 409, code: 'call_in_progress' }),
    )
    const { user } = render(null, 'pt-BR')
    const picker = await screen.findByRole('region', {
      name: 'Como Claudia entra em contato com o banco?',
    })
    await user.click(within(picker).getByRole('button', { name: /^Ligar/ }))
    expect(await screen.findByText('Não foi possível ligar')).toBeInTheDocument()
    expect(screen.getByText('Você já tem uma ligação em andamento.')).toBeInTheDocument()
  })

  it('switches the chrome with the UI language, never the phone', async () => {
    signInAs(SIM_CUSTOMER_ID)
    render('chat', 'es')
    expect(await screen.findByText('Hablando como')).toBeInTheDocument()
    expect(await screen.findByText('Suporte')).toBeInTheDocument()

    act(() => setTestLocale('pt-BR'))
    expect(await screen.findByText('Falando como')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trocar de cliente' })).toBeInTheDocument()
    expect(screen.getByText('Suporte')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Escreva sua mensagem' })).toBeInTheDocument()
  })

  it.each([
    ['es', SIM_CUSTOMER_ID, '10 fev, '],
    ['pt-BR', CLAUDIA_ID, '10 feb, '],
  ] as const)('dates the emails in the customer’s language (UI %s)', async (locale, id, date) => {
    const pt = id === SIM_CUSTOMER_ID
    signInAs(id, {
      conversation: makeCustomerConversation({
        status: 'with_agent',
        agentName: 'Daniela',
        channel: 'email',
        language: pt ? 'pt' : 'es',
      }),
      turns: [
        makeCustomerTurn({
          sequence: 1,
          kind: 'email',
          authorRole: 'analyst',
          authorName: 'Daniela',
          subject: 'Cobro',
          text: pt ? 'Olá, recebemos seu e-mail.' : 'Hola, recibimos tu correo.',
          createdAt: '2026-02-10T15:00:00Z',
        }),
      ],
    })
    render('email', locale)
    const thread = await screen.findByRole('list', {
      name: pt ? 'E-mails da conversa' : 'Correos del hilo',
    })
    expect(await within(thread).findByText(new RegExp(`^${date}`))).toBeInTheDocument()
  })
})
