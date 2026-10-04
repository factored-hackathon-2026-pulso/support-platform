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
  SIM_CUSTOMER_ID,
} from '@/test/conversation-fixtures'
import { createFakeSocketFactory } from '@/test/fake-socket'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import { SKIPPED_RATINGS_STORAGE_KEY } from '../hooks'
import { CustomerSimulatorScreen } from './CustomerSimulatorScreen'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    listDemoCustomers: vi.fn<typeof actual.listDemoCustomers>(),
    fetchCustomerCall: vi.fn<typeof actual.fetchCustomerCall>(),
    fetchCustomerConversation: vi.fn<typeof actual.fetchCustomerConversation>(),
    postCustomerTurn: vi.fn<typeof actual.postCustomerTurn>(),
    rateConversation: vi.fn<typeof actual.rateConversation>(),
  }
})

/** Claudia (es-CO): her last conversation with Daniela is closed and not rated. */
const CLAUDIA_ID = 'CUS-00000000000000000000001005'
const CLAUDIA_CASE = 'CASE-00000000000000000000000105'

const closed = (overrides: Parameters<typeof makeCustomerConversation>[0] = {}) =>
  makeCustomerConversation({
    caseId: CLAUDIA_CASE,
    status: 'closed',
    language: 'es',
    agentName: 'Daniela',
    closedAt: '2026-03-05T17:00:00Z',
    ...overrides,
  })

const closedNotice = makeCustomerTurn({
  sequence: 6,
  kind: 'notice',
  authorRole: 'system',
  language: 'es',
  text: 'La conversación terminó. Si necesitas algo más, escríbenos y abrimos una nueva.',
})

function signInAs(customerId: string, conversation = closed()) {
  customerSessionToken.set(fakeCustomerToken(customerId))
  vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
    conversation,
    turns: [closedNotice],
    pastConversationCount: 0,
  })
}

function renderSimulator() {
  const sockets = createFakeSocketFactory()
  const view = renderWithProviders(
    <CustomerSimulatorScreen createSocket={sockets.factory} channel="chat" />,
    {
      route: '/customer',
    },
  )
  return { ...view, sockets }
}

const survey = () => screen.getByRole('form', { name: '¿Cómo te atendió Daniela?' })

beforeEach(() => {
  vi.mocked(api.fetchCustomerCall).mockResolvedValue({ call: null })
  vi.mocked(api.listDemoCustomers).mockResolvedValue({ items: demoCustomers })
})

describe('satisfaction survey (slice 7)', () => {
  it('replaces the composer of a closed conversation with four faces', async () => {
    signInAs(CLAUDIA_ID)
    renderSimulator()
    expect(await screen.findByRole('form', { name: '¿Cómo te atendió Daniela?' })).toBeVisible()
    const group = within(survey()).getByRole('group', { name: 'Califica la atención' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual([
      'Mal',
      'Regular',
      'Bien',
      'Excelente',
    ])
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true)
    // No composer, no "write to start again" note, no chips while it asks.
    expect(screen.queryByRole('textbox', { name: 'Escribe tu mensaje' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Esta conversación terminó/)).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Sugestões' })).not.toBeInTheDocument()
    // The comment shows only after a face is picked; "Enviar" waits for one.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(survey()).getByRole('button', { name: 'Enviar' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(survey()).getByRole('button', { name: 'Ahora no' })).toBeInTheDocument()
  })

  it('asks to pick a face before sending', async () => {
    signInAs(CLAUDIA_ID)
    const { user } = renderSimulator()
    await screen.findByRole('form', { name: '¿Cómo te atendió Daniela?' })
    await user.click(within(survey()).getByRole('button', { name: 'Enviar' }))
    expect(api.rateConversation).not.toHaveBeenCalled()
    expect(within(survey()).getByRole('alert')).toHaveTextContent('Elige una opción para enviar.')
    expect(within(survey()).getByRole('radio', { name: 'Mal' })).toHaveFocus()
  })

  it('sends the pick with its comment, thanks, and gives the composer back', async () => {
    signInAs(CLAUDIA_ID)
    vi.mocked(api.rateConversation).mockResolvedValue(
      closed({
        rating: { score: 4, comment: 'Muy amable', ratedAt: '2026-03-05T17:05:00Z' },
      }),
    )
    const { user } = renderSimulator()
    await screen.findByRole('form', { name: '¿Cómo te atendió Daniela?' })
    await user.click(within(survey()).getByRole('radio', { name: 'Excelente' }))
    expect(within(survey()).getByRole('radio', { name: 'Excelente' })).toBeChecked()
    const comment = within(survey()).getByRole('textbox', {
      name: '¿Quieres contarnos algo más? (opcional)',
    })
    expect(comment).toHaveAttribute('maxlength', '500')
    expect(within(survey()).getByRole('button', { name: 'Enviar' })).not.toHaveAttribute(
      'aria-disabled',
    )
    await user.type(comment, '  Muy amable  ')
    await user.click(within(survey()).getByRole('button', { name: 'Enviar' }))

    const [caseId, body, key] = vi.mocked(api.rateConversation).mock.calls[0]!
    expect(caseId).toBe(CLAUDIA_CASE)
    expect(body).toEqual({ score: 4, comment: 'Muy amable' })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)

    expect(await screen.findByText('¡Gracias! Calificaste: Excelente')).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('status')
        .some((region) => region.textContent === '¡Gracias! Calificaste: Excelente'),
    ).toBe(true)
    expect(
      screen.queryByRole('form', { name: '¿Cómo te atendió Daniela?' }),
    ).not.toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'Escribe tu mensaje' })
    await waitFor(() => expect(input).toHaveFocus())
    expect(
      screen.getByText('Esta conversación terminó. Si escribes, empezamos una nueva.'),
    ).toBeVisible()
  })

  it('keeps the same key when a failed send is retried', async () => {
    signInAs(CLAUDIA_ID)
    vi.mocked(api.rateConversation)
      .mockRejectedValueOnce(new ApiProblem({ status: 0, code: 'network_error' }))
      .mockResolvedValueOnce(
        closed({ rating: { score: 2, comment: null, ratedAt: '2026-03-05T17:05:00Z' } }),
      )
    const { user } = renderSimulator()
    await screen.findByRole('form', { name: '¿Cómo te atendió Daniela?' })
    await user.click(within(survey()).getByRole('radio', { name: 'Regular' }))
    await user.click(within(survey()).getByRole('button', { name: 'Enviar' }))
    expect(await within(survey()).findByRole('alert')).toHaveTextContent(
      'No hay conexión. Inténtalo de nuevo.',
    )
    await user.click(within(survey()).getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByText('¡Gracias! Calificaste: Regular')).toBeInTheDocument()
    const calls = vi.mocked(api.rateConversation).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]![2]).toBe(calls[1]![2])
    expect(calls[1]![1]).toEqual({ score: 2, comment: null })
  })

  it('"Ahora no" skips this conversation, remembered after a reload', async () => {
    signInAs(CLAUDIA_ID)
    const { user, unmount } = renderSimulator()
    await screen.findByRole('form', { name: '¿Cómo te atendió Daniela?' })
    await user.click(within(survey()).getByRole('button', { name: 'Ahora no' }))
    const input = screen.getByRole('textbox', { name: 'Escribe tu mensaje' })
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.queryByRole('form', { name: /Cómo te atendió/ })).not.toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem(SKIPPED_RATINGS_STORAGE_KEY) ?? '[]')).toEqual([
      CLAUDIA_CASE,
    ])
    expect(api.rateConversation).not.toHaveBeenCalled()

    unmount()
    renderSimulator()
    expect(await screen.findByRole('textbox', { name: 'Escribe tu mensaje' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /Cómo te atendió/ })).not.toBeInTheDocument()
  })

  it('a rated conversation shows the thanks and the composer, no survey', async () => {
    signInAs(
      CLAUDIA_ID,
      closed({ rating: { score: 1, comment: null, ratedAt: '2026-03-05T17:05:00Z' } }),
    )
    renderSimulator()
    expect(await screen.findByText('¡Gracias! Calificaste: Mal')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Escribe tu mensaje' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /Cómo te atendió/ })).not.toBeInTheDocument()
  })

  it('an open conversation never asks', async () => {
    signInAs(CLAUDIA_ID, closed({ status: 'with_agent', closedAt: null }))
    renderSimulator()
    expect(await screen.findByRole('textbox', { name: 'Escribe tu mensaje' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /Cómo te atendió/ })).not.toBeInTheDocument()
  })

  it('speaks Portuguese to a Brazilian customer', async () => {
    signInAs(SIM_CUSTOMER_ID, closed({ caseId: 'CASE-00000000000000000000009001', language: 'pt' }))
    vi.mocked(api.rateConversation).mockResolvedValue(
      closed({
        caseId: 'CASE-00000000000000000000009001',
        language: 'pt',
        rating: { score: 3, comment: null, ratedAt: '2026-03-05T17:05:00Z' },
      }),
    )
    const { user } = renderSimulator()
    const form = await screen.findByRole('form', { name: 'Como foi o atendimento de Daniela?' })
    const group = within(form).getByRole('group', { name: 'Avalie o atendimento' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.closest('label')?.textContent),
    ).toEqual(['Ruim', 'Regular', 'Bom', 'Excelente'])
    expect(within(form).getByRole('button', { name: 'Agora não' })).toBeInTheDocument()
    await user.click(within(form).getByRole('radio', { name: 'Bom' }))
    expect(
      within(form).getByRole('textbox', { name: 'Quer contar algo mais? (opcional)' }),
    ).toHaveAttribute('placeholder', 'O que podemos melhorar')
    await user.click(within(form).getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByText('Obrigado! Você avaliou: Bom')).toBeInTheDocument()
  })

  it('stops asking when the rating arrives from another tab', async () => {
    signInAs(CLAUDIA_ID)
    const { sockets } = renderSimulator()
    await screen.findByRole('form', { name: '¿Cómo te atendió Daniela?' })
    act(() => sockets.last()?.open())
    act(() =>
      sockets
        .last()
        ?.receive(
          envelope(
            'conversation.updated',
            closed({ rating: { score: 3, comment: null, ratedAt: '2026-03-05T17:05:00Z' } }),
            CLAUDIA_CASE,
          ),
        ),
    )
    expect(await screen.findByText('¡Gracias! Calificaste: Bien')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /Cómo te atendió/ })).not.toBeInTheDocument()
  })

  it('an already rated answer refetches the conversation', async () => {
    signInAs(CLAUDIA_ID)
    vi.mocked(api.rateConversation).mockRejectedValue(
      new ApiProblem({ status: 409, code: 'already_rated' }),
    )
    const { user } = renderSimulator()
    await screen.findByRole('form', { name: '¿Cómo te atendió Daniela?' })
    vi.mocked(api.fetchCustomerConversation).mockResolvedValue({
      conversation: closed({
        rating: { score: 4, comment: null, ratedAt: '2026-03-05T17:05:00Z' },
      }),
      turns: [closedNotice],
      pastConversationCount: 0,
    })
    await user.click(within(survey()).getByRole('radio', { name: 'Bien' }))
    await user.click(within(survey()).getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByText('¡Gracias! Calificaste: Excelente')).toBeInTheDocument()
  })
})
