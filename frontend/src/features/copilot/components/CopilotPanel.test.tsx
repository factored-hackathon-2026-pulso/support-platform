import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import type { CopilotExchange, CopilotMessage } from '../types'
import { CopilotPanel } from './CopilotPanel'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchCopilotThread: vi.fn<typeof actual.fetchCopilotThread>(),
    askCopilot: vi.fn<typeof actual.askCopilot>(),
  }
})

const CASE_ID = 'CASE-00000000000000000000000101'
const AT = '2026-10-04T19:30:00Z'

function message(overrides: Partial<CopilotMessage>): CopilotMessage {
  return { id: 'CPM-1', role: 'analyst', text: '', createdAt: AT, answers: null, ...overrides }
}

function exchange(text: string, answers: string[]): CopilotExchange {
  return {
    question: message({ id: 'CPM-10', text }),
    answers: answers.map((answer, index) =>
      message({ id: `CPM-1${index + 1}`, role: 'copilot', text: answer, answers: 'CPM-10' }),
    ),
    replayed: false,
  }
}

beforeEach(() => {
  vi.mocked(api.fetchCopilotThread).mockReset()
  vi.mocked(api.fetchCopilotThread).mockResolvedValue({
    caseId: CASE_ID,
    available: true,
    messages: [],
  })
  vi.mocked(api.askCopilot).mockReset()
})

function renderPanel({ closed = false } = {}) {
  return renderWithProviders(
    <CopilotPanel caseId={CASE_ID} customerName="Natalia Guzmán Rincón" closed={closed} />,
    { staff: analystStaff, aiEnabled: true },
  )
}

describe('CopilotPanel (the "Copiloto" tab, slice 20)', () => {
  it('says quietly that it only reads, and the starter questions only fill the box', async () => {
    const { user } = renderPanel()
    expect(
      await screen.findByText(
        'Consulta y calcula con los datos de Natalia. No hace cambios ni le escribe al cliente.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pregúntale sobre Natalia' })).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: '¿Tiene reclamos anteriores y cómo se cerraron?' }),
    )
    const box = screen.getByRole('textbox', { name: 'Pregúntale al copiloto' })
    expect(box).toHaveValue('¿Tiene reclamos anteriores y cómo se cerraron?')
    expect(box).toHaveFocus()
    expect(api.askCopilot).not.toHaveBeenCalled()
    expect(screen.getByText('Solo tú ves estas preguntas.')).toBeInTheDocument()
  })

  it('waits with the box disabled, then shows every answer under the question', async () => {
    let resolve!: (value: CopilotExchange) => void
    vi.mocked(api.askCopilot).mockReturnValue(new Promise((done) => (resolve = done)))
    const { user } = renderPanel()
    const box = await screen.findByRole('textbox', { name: 'Pregúntale al copiloto' })
    await user.type(box, '¿Cuánto debe en la tarjeta?')
    await user.click(screen.getByRole('button', { name: 'Preguntar' }))

    expect(
      await screen.findByText('Buscando la respuesta: suele tardar unos segundos.'),
    ).toBeInTheDocument()
    expect(box).toHaveAttribute('aria-disabled', 'true')
    expect(box).toHaveAttribute('readonly')
    expect(box).toHaveValue('')
    const [caseId, body] = vi.mocked(api.askCopilot).mock.calls[0]!
    expect(caseId).toBe(CASE_ID)
    expect(body.text).toBe('¿Cuánto debe en la tarjeta?')
    expect(body.clientMessageId).toMatch(/[0-9a-f-]{36}/)

    resolve(exchange('¿Cuánto debe en la tarjeta?', ['Debe 1.342,80 USD.', '¿Qué más necesitas?']))
    const thread = await screen.findByRole('list', { name: 'Preguntas al copiloto' })
    expect(await within(thread).findByText('Debe 1.342,80 USD.')).toBeInTheDocument()
    expect(within(thread).getByText('¿Qué más necesitas?')).toBeInTheDocument()
    expect(within(thread).getAllByRole('listitem')).toHaveLength(1)
    await waitFor(() => expect(box).not.toHaveAttribute('readonly'))
    expect(screen.queryByText('Buscando la respuesta: suele tardar unos segundos.')).toBeNull()
  })

  it('offers "Reintentar" for a failed question, with the same id', async () => {
    vi.mocked(api.askCopilot).mockRejectedValueOnce(
      new ApiProblem({ status: 503, code: 'agent_core_unavailable' }),
    )
    const { user } = renderPanel()
    const box = await screen.findByRole('textbox', { name: 'Pregúntale al copiloto' })
    await user.type(box, '¿Tiene disputas abiertas?{Enter}')
    const thread = await screen.findByRole('list', { name: 'Preguntas al copiloto' })
    expect(await within(thread).findByRole('alert')).toHaveTextContent(
      'No se pudo responder. Inténtalo de nuevo.',
    )
    vi.mocked(api.askCopilot).mockResolvedValueOnce(
      exchange('¿Tiene disputas abiertas?', ['Una, por 120 USD.']),
    )
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Una, por 120 USD.')).toBeInTheDocument()
    const [first, second] = vi.mocked(api.askCopilot).mock.calls
    expect(second?.[1].clientMessageId).toBe(first?.[1].clientMessageId)
    expect(within(thread).queryByRole('alert')).toBeNull()
  })

  it('keeps the thread of a closed case readable and asks nothing', async () => {
    vi.mocked(api.fetchCopilotThread).mockResolvedValue({
      caseId: CASE_ID,
      available: true,
      messages: [
        message({ id: 'CPM-1', text: '¿Cuánto debe?' }),
        message({ id: 'CPM-2', role: 'copilot', text: 'Nada.', answers: 'CPM-1' }),
      ],
    })
    renderPanel({ closed: true })
    expect(await screen.findByText('Nada.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Pregúntale al copiloto' })).toHaveAttribute(
      'readonly',
    )
    expect(
      screen.getByText('El caso está cerrado: el copiloto ya no responde.'),
    ).toBeInTheDocument()
  })
})

describe('CopilotPanel in Portuguese (slice 23)', () => {
  it('speaks pt-BR: the notice, the starters, a failed question and its retry', async () => {
    vi.mocked(api.askCopilot).mockRejectedValueOnce(
      new ApiProblem({ status: 503, code: 'agent_core_unavailable' }),
    )
    const { user } = renderWithProviders(
      <CopilotPanel caseId={CASE_ID} customerName="Natalia Guzmán Rincón" closed={false} />,
      { staff: analystStaff, aiEnabled: true, locale: 'pt-BR' },
    )
    expect(
      await screen.findByText(
        'Consulta e calcula com os dados de Natalia. Não faz alterações nem escreve para o cliente.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pergunte sobre Natalia' })).toBeInTheDocument()
    expect(screen.getByText('Só você vê estas perguntas.')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'Ele tem reclamações anteriores e como foram encerradas?',
      }),
    )
    const box = screen.getByRole('textbox', { name: 'Pergunte ao copiloto' })
    expect(box).toHaveValue('Ele tem reclamações anteriores e como foram encerradas?')
    await user.click(screen.getByRole('button', { name: 'Perguntar' }))
    const thread = await screen.findByRole('list', { name: 'Perguntas ao copiloto' })
    expect(await within(thread).findByRole('alert')).toHaveTextContent(
      'Não foi possível responder. Tente de novo.',
    )
    expect(within(thread).getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })
})
