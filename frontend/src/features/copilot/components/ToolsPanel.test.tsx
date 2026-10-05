import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import { toolQuestion } from '../model'
import type { CopilotSuggestion } from '../types'
import { ToolsPanel } from './ToolsPanel'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchCopilotThread: vi.fn<typeof actual.fetchCopilotThread>(),
    askCopilot: vi.fn<typeof actual.askCopilot>(),
    fetchLatestSuggestion: vi.fn<typeof actual.fetchLatestSuggestion>(),
    requestSuggestion: vi.fn<typeof actual.requestSuggestion>(),
    recordToolUsed: vi.fn<typeof actual.recordToolUsed>(),
  }
})

const CASE_ID = 'CASE-00000000000000000000000101'
const AT = '2026-10-04T19:30:00Z'
const TOOL = {
  type: 'tool' as const,
  tool: 'leer_movimientos@1',
  label: 'Movimientos de la cuenta',
  why: 'Cobros y comisiones en un rango de fechas',
}

function suggestion(overrides: Partial<CopilotSuggestion> = {}): CopilotSuggestion {
  return {
    id: 'CPS-1',
    caseId: CASE_ID,
    trigger: 'customer_message',
    status: 'ready',
    stale: false,
    createdAt: AT,
    replyDecision: null,
    escalationAccepted: false,
    failureCode: null,
    suggestions: [
      TOOL,
      {
        type: 'action',
        tool: 'radicar_pqr@1',
        summary: 'Radicar una disputa por 120 USD',
        executable: false,
      },
    ],
    ...overrides,
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
  vi.mocked(api.fetchLatestSuggestion).mockReset()
  vi.mocked(api.fetchLatestSuggestion).mockResolvedValue({
    available: true,
    suggestion: suggestion(),
  })
  vi.mocked(api.requestSuggestion).mockReset()
  vi.mocked(api.recordToolUsed).mockReset()
  vi.mocked(api.recordToolUsed).mockResolvedValue(undefined)
})

function renderPanel({ closed = false } = {}) {
  const onOpenCopilot = vi.fn<() => void>()
  const view = renderWithProviders(
    <ToolsPanel caseId={CASE_ID} closed={closed} canAsk onOpenCopilot={onOpenCopilot} />,
    { staff: analystStaff, aiEnabled: true },
  )
  return { ...view, onOpenCopilot }
}

describe('ToolsPanel (the "Herramientas" tab, slice 20)', () => {
  it('lists the reads to look at and the prepared actions as information only', async () => {
    renderPanel()
    const tools = await screen.findByRole('region', { name: 'Para consultar' })
    expect(within(tools).getByText('Movimientos de la cuenta')).toBeInTheDocument()
    expect(within(tools).getByText('Cobros y comisiones en un rango de fechas')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Solo consultan: ninguna hace cambios en la cuenta. Cada uso queda en la auditoría.',
      ),
    ).toBeInTheDocument()
    const actions = screen.getByRole('region', { name: 'Preparadas, sin ejecutar' })
    expect(within(actions).getByText('Radicar una disputa por 120 USD')).toBeInTheDocument()
    expect(within(actions).getByText('Solo información')).toBeInTheDocument()
    expect(within(actions).queryByRole('button')).toBeNull()
    expect(
      screen.getByText(
        'El copiloto no las ejecuta. Si corresponde, hazlo tú por el flujo de siempre.',
      ),
    ).toBeInTheDocument()
  })

  it('"Usar" asks the copilot its predefined question and shows the answer on the card', async () => {
    vi.mocked(api.askCopilot).mockImplementation(async (_caseId, body) => ({
      question: { id: 'CPM-1', role: 'analyst', text: body.text, createdAt: AT, answers: null },
      answers: [
        {
          id: 'CPM-2',
          role: 'copilot',
          text: 'Dos cobros de 18.900.',
          createdAt: AT,
          answers: 'CPM-1',
        },
      ],
      replayed: false,
    }))
    const { user, onOpenCopilot } = renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Usar Movimientos de la cuenta' }))
    expect(vi.mocked(api.askCopilot).mock.calls[0]?.[1].text).toBe(toolQuestion(TOOL))
    // Slice 21: the use is a stage signal of the case type.
    expect(api.recordToolUsed).toHaveBeenCalledWith(CASE_ID, 'CPS-1', 'leer_movimientos@1')
    expect(await screen.findByText('Dos cobros de 18.900.')).toBeInTheDocument()
    expect(screen.getByText('Consultada')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ver en Copiloto' }))
    expect(onOpenCopilot).toHaveBeenCalledTimes(1)
  })

  it('a failed tool feedback never gets in her way', async () => {
    vi.mocked(api.recordToolUsed).mockRejectedValue(new ApiProblem({ status: 503, code: 'x' }))
    vi.mocked(api.askCopilot).mockResolvedValue({
      question: { id: 'CPM-1', role: 'analyst', text: 'q', createdAt: AT, answers: null },
      answers: [],
      replayed: false,
    })
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Usar Movimientos de la cuenta' }))
    expect(api.askCopilot).toHaveBeenCalledTimes(1)
    expect(api.recordToolUsed).toHaveBeenCalledTimes(1) // its rejection is swallowed
  })

  it('"Sugerir" asks for a fresh one and retries a failure with the same key', async () => {
    vi.mocked(api.requestSuggestion).mockRejectedValueOnce(
      new ApiProblem({ status: 503, code: 'agent_core_unavailable' }),
    )
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Sugerir' }))
    expect(
      await screen.findByText('No se pudo preparar la sugerencia. Inténtalo de nuevo.'),
    ).toBeInTheDocument()
    vi.mocked(api.requestSuggestion).mockResolvedValueOnce(
      suggestion({ id: 'CPS-2', suggestions: [{ ...TOOL, label: 'Condiciones del producto' }] }),
    )
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Condiciones del producto')).toBeInTheDocument()
    const [first, second] = vi.mocked(api.requestSuggestion).mock.calls
    expect(second?.[1]).toBe(first?.[1])
    expect(first?.[0]).toBe(CASE_ID)
  })

  it('says when it is being prepared and when the customer wrote after it', async () => {
    vi.mocked(api.fetchLatestSuggestion).mockResolvedValueOnce({
      available: true,
      suggestion: suggestion({ status: 'preparing', suggestions: [] }),
    })
    const { unmount } = renderPanel()
    expect(
      await screen.findByText('Preparando sugerencias: suele tardar unos segundos.'),
    ).toBeInTheDocument()
    unmount()

    vi.mocked(api.fetchLatestSuggestion).mockResolvedValueOnce({
      available: true,
      suggestion: suggestion({ stale: true }),
    })
    renderPanel()
    expect(
      await screen.findByText(
        'El cliente escribió después de esta sugerencia. Pide otra con Sugerir.',
      ),
    ).toBeInTheDocument()
  })

  it('shows an empty state that leads to "Copiloto" when there is nothing', async () => {
    vi.mocked(api.fetchLatestSuggestion).mockResolvedValue({ available: true, suggestion: null })
    const { user, onOpenCopilot } = renderPanel()
    expect(
      await screen.findByRole('heading', { name: 'Todavía no hay herramientas para este caso' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ir a Copiloto' }))
    expect(onOpenCopilot).toHaveBeenCalledTimes(1)
  })

  it('offers no "Sugerir" on a closed case', async () => {
    renderPanel({ closed: true })
    await screen.findByText('Movimientos de la cuenta')
    expect(screen.queryByRole('button', { name: 'Sugerir' })).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Usar Movimientos de la cuenta' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
  })
})
