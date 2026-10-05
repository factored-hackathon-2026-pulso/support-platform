import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CopilotApi from '@/features/copilot/api'
import { fetchLatestSuggestion, sendSuggestionFeedback } from '@/features/copilot/api'
import type { CopilotMode, CopilotSuggestion } from '@/features/copilot'
import { makeCaseSummary } from '@/test/case-fixtures'
import {
  makeAnalystTurn,
  makeCaseDetail,
  makeEscalation,
  seededTurns,
} from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import type { CaseDetail } from '../types'
import { ConversationPane } from './ConversationPane'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchCaseDetail: vi.fn<typeof actual.fetchCaseDetail>(),
    fetchTurns: vi.fn<typeof actual.fetchTurns>(),
    markCaseRead: vi.fn<typeof actual.markCaseRead>(),
    postAnalystTurn: vi.fn<typeof actual.postAnalystTurn>(),
    escalateCase: vi.fn<typeof actual.escalateCase>(),
  }
})

vi.mock('@/features/copilot/api', async (importOriginal) => {
  const actual = await importOriginal<typeof CopilotApi>()
  return {
    ...actual,
    fetchLatestSuggestion: vi.fn<typeof actual.fetchLatestSuggestion>(),
    sendSuggestionFeedback: vi.fn<typeof actual.sendSuggestionFeedback>(),
  }
})

const DRAFT = 'Marcela, revisé tu cuenta: los dos cobros de 18.900 no corresponden.'

function suggestion(overrides: Partial<CopilotSuggestion> = {}): CopilotSuggestion {
  return {
    id: 'CPS-7',
    caseId: makeCaseDetail().case.id,
    trigger: 'customer_message',
    status: 'ready',
    stale: false,
    createdAt: '2026-03-05T15:50:00Z',
    replyDecision: null,
    escalationAccepted: false,
    failureCode: null,
    suggestions: [{ type: 'reply', text: DRAFT, citations: [], language: 'es' }],
    ...overrides,
  }
}

function escalatable(): CaseDetail {
  const detail = makeCaseDetail()
  return { ...detail, capabilities: { ...detail.capabilities, canEscalate: true } }
}

function setup({
  detail = makeCaseDetail(),
  copilotMode = 'drafts',
  aiEnabled = true,
}: { detail?: CaseDetail; copilotMode?: CopilotMode | null; aiEnabled?: boolean } = {}) {
  vi.mocked(api.fetchCaseDetail).mockResolvedValue(detail)
  vi.mocked(api.fetchTurns).mockResolvedValue({
    items: seededTurns(),
    olderCursor: null,
    lastSequence: 4,
  })
  vi.mocked(api.markCaseRead).mockResolvedValue(detail.case)
  return renderWithProviders(
    <ConversationPane caseId={detail.case.id} copilotMode={copilotMode} />,
    { staff: analystStaff, aiEnabled },
  )
}

beforeEach(() => {
  vi.mocked(api.postAnalystTurn).mockReset()
  vi.mocked(api.postAnalystTurn).mockImplementation(async (_caseId, body) => ({
    turn: makeAnalystTurn(5, body.text, body.clientMessageId),
    case: makeCaseSummary({ version: 4, lastSequence: 5, assignedAnalystId: analystStaff.id }),
  }))
  vi.mocked(api.escalateCase).mockReset()
  vi.mocked(fetchLatestSuggestion).mockReset()
  vi.mocked(fetchLatestSuggestion).mockResolvedValue({ available: true, suggestion: suggestion() })
  vi.mocked(sendSuggestionFeedback).mockReset()
})

describe('the copilot draft above the composer (slice 20)', () => {
  it('"Usar" puts the draft in the composer and the reply carries its id; nothing is sent alone', async () => {
    const { user } = setup()
    const bar = await screen.findByRole('region', { name: 'Borrador del copiloto' })
    expect(within(bar).getByText(DRAFT)).toBeInTheDocument()
    expect(within(bar).getByText('Revísalo antes de usarlo')).toBeInTheDocument()

    await user.click(within(bar).getByRole('button', { name: 'Usar' }))
    const box = screen.getByRole('textbox', { name: 'Escribe al cliente' })
    expect(box).toHaveValue(DRAFT)
    expect(api.postAnalystTurn).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Borrador del copiloto' })).toBeNull()
    expect(
      screen.getByText('Borrador del copiloto en el cuadro: revísalo y envíalo'),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toHaveFocus())

    vi.mocked(fetchLatestSuggestion).mockResolvedValue({
      available: true,
      suggestion: suggestion({ replyDecision: 'used', suggestions: [] }),
    })
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(api.postAnalystTurn).toHaveBeenCalledTimes(1))
    const [, body] = vi.mocked(api.postAnalystTurn).mock.calls[0]!
    expect(body).toMatchObject({ text: DRAFT, copilotSuggestionId: 'CPS-7' })
    // The decided draft is read again and does not come back.
    await waitFor(() => expect(fetchLatestSuggestion).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('region', { name: 'Borrador del copiloto' })).toBeNull()
  })

  it('"Editar" focuses the box; an edited reply still carries the id', async () => {
    const { user } = setup()
    const bar = await screen.findByRole('region', { name: 'Borrador del copiloto' })
    await user.click(within(bar).getByRole('button', { name: 'Editar' }))
    const box = screen.getByRole('textbox', { name: 'Escribe al cliente' })
    await waitFor(() => expect(box).toHaveFocus())
    expect(screen.getByText('Editando el borrador del copiloto')).toBeInTheDocument()
    await user.type(box, ' Te confirmo hoy.{Enter}')
    await waitFor(() => expect(api.postAnalystTurn).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.postAnalystTurn).mock.calls[0]![1]).toMatchObject({
      text: `${DRAFT} Te confirmo hoy.`,
      copilotSuggestionId: 'CPS-7',
    })
  })

  it('a reply of her own carries no id', async () => {
    const { user } = setup()
    await screen.findByRole('region', { name: 'Borrador del copiloto' })
    await user.type(screen.getByRole('textbox', { name: 'Escribe al cliente' }), 'Hola{Enter}')
    await waitFor(() => expect(api.postAnalystTurn).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.postAnalystTurn).mock.calls[0]![1]).not.toHaveProperty(
      'copilotSuggestionId',
    )
  })

  it('"Descartar" sends the feedback and the draft goes away', async () => {
    vi.mocked(sendSuggestionFeedback).mockResolvedValue(
      suggestion({ replyDecision: 'discarded', suggestions: [] }),
    )
    const { user } = setup()
    const bar = await screen.findByRole('region', { name: 'Borrador del copiloto' })
    await user.click(within(bar).getByRole('button', { name: 'Descartar' }))
    expect(screen.queryByRole('region', { name: 'Borrador del copiloto' })).toBeNull()
    expect(sendSuggestionFeedback).toHaveBeenCalledWith(
      makeCaseDetail().case.id,
      'CPS-7',
      'discarded',
    )
  })

  it('shows nothing with AI off, or when the mode has no drafts (stage 2)', async () => {
    const { unmount } = setup({ aiEnabled: false })
    await screen.findByRole('textbox', { name: 'Escribe al cliente' })
    expect(screen.queryByRole('region', { name: 'Borrador del copiloto' })).toBeNull()
    expect(fetchLatestSuggestion).not.toHaveBeenCalled()
    unmount()

    setup({ copilotMode: 'tools' })
    await screen.findByRole('textbox', { name: 'Escribe al cliente' })
    expect(screen.queryByRole('region', { name: 'Borrador del copiloto' })).toBeNull()
  })

  it('slice 21: a stage-3 type gets the draft; stage 1 and stage 0 never ask for one', async () => {
    const { unmount } = setup({ copilotMode: 'drafts' })
    expect(await screen.findByRole('region', { name: 'Borrador del copiloto' })).toBeVisible()
    unmount()

    vi.mocked(fetchLatestSuggestion).mockClear()
    for (const copilotMode of ['answer', null] as const) {
      const view = setup({ copilotMode })
      await screen.findByRole('textbox', { name: 'Escribe al cliente' })
      expect(screen.queryByRole('region', { name: 'Borrador del copiloto' })).toBeNull()
      view.unmount()
    }
    expect(fetchLatestSuggestion).not.toHaveBeenCalled()
  })
})

describe('the copilot recommends escalating (slice 20)', () => {
  const recommendation = suggestion({
    suggestions: [
      {
        type: 'escalate',
        reasonCode: 'policy:pide_supervisor',
        evidence: ['Pidió hablar con un supervisor dos veces'],
        motiveDraft: 'La clienta pide supervisión: no reconoce dos cobros.',
      },
    ],
  })

  it('shows its reason and evidence and opens the dialog prefilled; the escalation carries the id', async () => {
    vi.mocked(fetchLatestSuggestion).mockResolvedValue({
      available: true,
      suggestion: recommendation,
    })
    const detail = escalatable()
    vi.mocked(api.escalateCase).mockResolvedValue({
      escalation: makeEscalation(),
      case: { ...detail.case, version: detail.case.version + 1, escalated: true },
    })
    const { user } = setup({ detail })
    const notice = await screen.findByRole('region', { name: 'El copiloto recomienda escalar' })
    expect(notice).toHaveTextContent('Una política lo pide: Pide supervisor')
    expect(within(notice).getByText('Pidió hablar con un supervisor dos veces')).toBeInTheDocument()

    await user.click(within(notice).getByRole('button', { name: 'Revisar y escalar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Escalar a supervisión' })
    expect(within(dialog).getByRole('textbox', { name: 'Motivo' })).toHaveValue(
      'La clienta pide supervisión: no reconoce dos cobros.',
    )
    expect(
      within(dialog).getByText('El copiloto sugirió este motivo. Revísalo antes de escalar.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Escalar' }))
    await waitFor(() => expect(api.escalateCase).toHaveBeenCalledTimes(1))
    const [, motive, , suggestionId] = vi.mocked(api.escalateCase).mock.calls[0]!
    expect(motive).toBe('La clienta pide supervisión: no reconoce dos cobros.')
    expect(suggestionId).toBe('CPS-7')
  })

  it('"Ahora no" hides it, and the usual dialog carries no id', async () => {
    vi.mocked(fetchLatestSuggestion).mockResolvedValue({
      available: true,
      suggestion: recommendation,
    })
    const { user } = setup({ detail: escalatable() })
    const notice = await screen.findByRole('region', { name: 'El copiloto recomienda escalar' })
    await user.click(within(notice).getByRole('button', { name: 'Ahora no' }))
    expect(screen.queryByRole('region', { name: 'El copiloto recomienda escalar' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Escalar a supervisión' }))
    const dialog = await screen.findByRole('dialog', { name: 'Escalar a supervisión' })
    expect(within(dialog).getByRole('textbox', { name: 'Motivo' })).toHaveValue('')
    expect(within(dialog).queryByText(/El copiloto sugirió/)).toBeNull()
  })

  it('is not shown when the case cannot be escalated', async () => {
    vi.mocked(fetchLatestSuggestion).mockResolvedValue({
      available: true,
      suggestion: recommendation,
    })
    setup()
    await screen.findByRole('textbox', { name: 'Escribe al cliente' })
    await waitFor(() => expect(fetchLatestSuggestion).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'El copiloto recomienda escalar' })).toBeNull()
  })
})
