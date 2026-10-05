import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import type { CopilotSuggestion } from '../types'
import { CopilotDraft, type CopilotDraftProps } from './CopilotDraft'
import { EscalationSuggestion, type EscalationSuggestionProps } from './EscalationSuggestion'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchLatestSuggestion: vi.fn<typeof actual.fetchLatestSuggestion>(),
    sendSuggestionFeedback: vi.fn<typeof actual.sendSuggestionFeedback>(),
  }
})

const CASE_ID = 'CASE-00000000000000000000000101'
const DRAFT = 'Olá, Natalia. Já revisei a cobrança.'

function suggestion(overrides: Partial<CopilotSuggestion> = {}): CopilotSuggestion {
  return {
    id: 'CPS-7',
    caseId: CASE_ID,
    trigger: 'customer_message',
    status: 'ready',
    stale: false,
    createdAt: '2026-10-04T19:30:00Z',
    replyDecision: null,
    escalationAccepted: false,
    failureCode: null,
    suggestions: [
      { type: 'reply', text: DRAFT, citations: [], language: 'pt' },
      {
        type: 'escalate',
        reasonCode: 'rule:tercer_contacto_7d',
        motiveDraft: 'Terceiro contato em 7 dias.',
        evidence: ['Três casos em 7 dias'],
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(api.fetchLatestSuggestion).mockReset()
  vi.mocked(api.fetchLatestSuggestion).mockResolvedValue({
    available: true,
    suggestion: suggestion(),
  })
  vi.mocked(api.sendSuggestionFeedback).mockReset()
})

describe('the draft and the escalation recommendation in Portuguese (slice 23)', () => {
  it('shows the draft in pt-BR and hands it over with "Usar"', async () => {
    const onTake = vi.fn<CopilotDraftProps['onTake']>()
    const { user } = renderWithProviders(
      <CopilotDraft caseId={CASE_ID} enabled taken={null} onTake={onTake} />,
      { staff: analystStaff, aiEnabled: true, locale: 'pt-BR' },
    )
    const bar = await screen.findByRole('region', { name: 'Rascunho do copiloto' })
    expect(within(bar).getByText('Revise antes de usar')).toBeInTheDocument()
    expect(within(bar).getByText('Ele propõe com base no que leu do caso.')).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Descartar' })).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Usar' }))
    expect(onTake).toHaveBeenCalledWith(DRAFT, { suggestionId: 'CPS-7', mode: 'use' })
  })

  it('says a failed discard in a pt-BR toast', async () => {
    vi.mocked(api.sendSuggestionFeedback).mockRejectedValue(
      new ApiProblem({ status: 503, code: 'agent_core_unavailable' }),
    )
    const { user } = renderWithProviders(
      <CopilotDraft
        caseId={CASE_ID}
        enabled
        taken={null}
        onTake={vi.fn<CopilotDraftProps['onTake']>()}
      />,
      { staff: analystStaff, aiEnabled: true, locale: 'pt-BR' },
    )
    const bar = await screen.findByRole('region', { name: 'Rascunho do copiloto' })
    await user.click(within(bar).getByRole('button', { name: 'Descartar' }))
    expect(await screen.findByText('O rascunho não foi descartado')).toBeInTheDocument()
    expect(screen.getByText('Tente de novo em instantes.')).toBeInTheDocument()
  })

  it('says the draft is in the composer in pt-BR', () => {
    renderWithProviders(
      <CopilotDraft
        caseId={CASE_ID}
        enabled
        taken={{ suggestionId: 'CPS-7', mode: 'edit' }}
        onTake={vi.fn<CopilotDraftProps['onTake']>()}
      />,
      { staff: analystStaff, aiEnabled: true, locale: 'pt-BR' },
    )
    expect(screen.getByText('Editando o rascunho do copiloto')).toBeInTheDocument()
  })

  it('recommends escalating in pt-BR, with its reason and evidence', async () => {
    const onReview = vi.fn<EscalationSuggestionProps['onReview']>()
    const { user } = renderWithProviders(
      <EscalationSuggestion caseId={CASE_ID} enabled onReview={onReview} />,
      { staff: analystStaff, aiEnabled: true, locale: 'pt-BR' },
    )
    const notice = await screen.findByRole('region', { name: 'O copiloto recomenda escalar' })
    expect(
      within(notice).getByText('O copiloto recomenda escalar para a supervisão'),
    ).toBeInTheDocument()
    expect(
      within(notice).getByText('Uma regra do copiloto exige: Tercer contacto 7d'),
    ).toBeInTheDocument()
    expect(within(notice).getByText('Em que se baseia')).toBeInTheDocument()
    await user.click(within(notice).getByRole('button', { name: 'Revisar e escalar' }))
    expect(onReview).toHaveBeenCalledWith({
      suggestionId: 'CPS-7',
      motive: 'Terceiro contato em 7 dias.',
    })
    await user.click(within(notice).getByRole('button', { name: 'Agora não' }))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'O copiloto recomenda escalar' })).toBeNull(),
    )
  })
})
