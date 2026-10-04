import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { NOW } from '@/test/case-fixtures'
import {
  makeAnsweredEscalation,
  makeCaseDetail,
  makeEscalation,
  seededTurns,
} from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import type { CaseDetail, Escalation, EscalationResult } from '../types'
import { ConversationPane } from './ConversationPane'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchCaseDetail: vi.fn<typeof actual.fetchCaseDetail>(),
    fetchTurns: vi.fn<typeof actual.fetchTurns>(),
    markCaseRead: vi.fn<typeof actual.markCaseRead>(),
    escalateCase: vi.fn<typeof actual.escalateCase>(),
    withdrawEscalation: vi.fn<typeof actual.withdrawEscalation>(),
    acknowledgeEscalation: vi.fn<typeof actual.acknowledgeEscalation>(),
  }
})

function escalatable(overrides: Partial<CaseDetail> = {}): CaseDetail {
  const detail = makeCaseDetail(overrides)
  return { ...detail, capabilities: { ...detail.capabilities, canEscalate: true } }
}

function result(detail: CaseDetail, escalation: Escalation): EscalationResult {
  return {
    escalation,
    case: {
      ...detail.case,
      version: detail.case.version + 1,
      escalated: escalation.state === 'open',
    },
  }
}

function setup(detail: CaseDetail, mode: 'workspace' | 'supervision' = 'workspace') {
  vi.mocked(api.fetchCaseDetail).mockResolvedValue(detail)
  vi.mocked(api.fetchTurns).mockResolvedValue({
    items: seededTurns(),
    olderCursor: null,
    lastSequence: 4,
  })
  vi.mocked(api.markCaseRead).mockResolvedValue(detail.case)
  return renderWithProviders(<ConversationPane caseId={detail.case.id} mode={mode} />, {
    staff: analystStaff,
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(api.escalateCase).mockReset()
  vi.mocked(api.withdrawEscalation).mockReset()
  vi.mocked(api.acknowledgeEscalation).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Escalar a supervisión (slice 9)', () => {
  it('is offered only when the case can be escalated', async () => {
    setup(makeCaseDetail())
    await screen.findByRole('button', { name: 'Cerrar caso' })
    expect(screen.queryByRole('button', { name: 'Escalar a supervisión' })).toBeNull()
  })

  it('asks for a motive, counts it and sends it with an Idempotency-Key', async () => {
    const user = userEvent.setup()
    const detail = escalatable()
    vi.mocked(api.escalateCase).mockResolvedValue(result(detail, makeEscalation()))
    setup(detail)
    await user.click(await screen.findByRole('button', { name: 'Escalar a supervisión' }))
    const dialog = await screen.findByRole('dialog', { name: 'Escalar a supervisión' })
    expect(within(dialog).getByText('Lo ve el equipo. El cliente no.')).toBeInTheDocument()
    expect(within(dialog).getByText('El caso sigue contigo')).toBeInTheDocument()
    expect(within(dialog).getByText('0/500')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Escalar' }))
    const motive = within(dialog).getByRole('textbox', { name: 'Motivo' })
    expect(within(dialog).getByText('Escribe el motivo.')).toBeInTheDocument()
    expect(motive).toHaveFocus()
    expect(api.escalateCase).not.toHaveBeenCalled()

    await user.type(motive, '  Pide hablar con supervisión  ')
    expect(within(dialog).getByText('27/500')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Escalar' }))
    await waitFor(() => expect(api.escalateCase).toHaveBeenCalledTimes(1))
    const [caseId, sent, key] = vi.mocked(api.escalateCase).mock.calls[0]!
    expect([caseId, sent]).toEqual([detail.case.id, 'Pide hablar con supervisión'])
    expect(key).toMatch(/.{8,}/)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('Escalaste el caso a supervisión')).toBeInTheDocument()
    // The card replaces the button.
    expect(
      await screen.findByRole('region', { name: 'Escalamiento a supervisión' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Escalar a supervisión' })).toBeNull()
  })

  it('says why the server refused', async () => {
    const user = userEvent.setup()
    vi.mocked(api.escalateCase).mockRejectedValue(
      new ApiProblem({ status: 409, code: 'escalation_open' }),
    )
    setup(escalatable())
    await user.click(await screen.findByRole('button', { name: 'Escalar a supervisión' }))
    const dialog = await screen.findByRole('dialog', { name: 'Escalar a supervisión' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Motivo' }), 'Ayuda')
    await user.click(within(dialog).getByRole('button', { name: 'Escalar' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Este caso ya está escalado a supervisión.',
    )
  })
})

describe('Escalation card (slice 9)', () => {
  it('shows her open escalation and withdraws it', async () => {
    const user = userEvent.setup()
    const open = makeEscalation()
    const detail = makeCaseDetail({ escalation: open })
    detail.case = { ...detail.case, escalated: true }
    vi.mocked(api.withdrawEscalation).mockResolvedValue(
      result(detail, makeEscalation({ state: 'withdrawn', resolvedAt: NOW.toISOString() })),
    )
    setup(detail)
    const card = await screen.findByRole('region', { name: 'Escalamiento a supervisión' })
    expect(within(card).getByText('Escalado a supervisión')).toBeInTheDocument()
    expect(within(card).getByText('Solo el equipo')).toBeInTheDocument()
    expect(within(card).getByText('hace 6 min')).toBeInTheDocument()
    const more = within(card).getByRole('button', { name: 'Ver más' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await user.click(more)
    expect(within(card).getByRole('button', { name: 'Ver menos' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await user.click(within(card).getByRole('button', { name: 'Retirar escalamiento' }))
    await waitFor(() =>
      expect(api.withdrawEscalation).toHaveBeenCalledWith(detail.case.id, open.id),
    )
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Escalamiento a supervisión' })).toBeNull(),
    )
  })

  it('shows what supervision answered until "Entendido"', async () => {
    const user = userEvent.setup()
    const answered = makeAnsweredEscalation()
    const detail = makeCaseDetail({ escalation: answered })
    vi.mocked(api.acknowledgeEscalation).mockResolvedValue(
      result(detail, { ...answered, acknowledgedAt: NOW.toISOString() }),
    )
    setup(detail)
    const card = await screen.findByRole('region', { name: 'Escalamiento a supervisión' })
    expect(within(card).getByText('Lucía Herrera respondió')).toBeInTheDocument()
    expect(
      within(card).getByText('Ya hablé con ella por aquí. Sigue tú con el caso.'),
    ).toBeInTheDocument()
    expect(within(card).getByText('Tu motivo:')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Entendido' }))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Escalamiento a supervisión' })).toBeNull(),
    )
    expect(api.acknowledgeEscalation).toHaveBeenCalledWith(detail.case.id, answered.id)
  })

  it('shows supervision the open escalation, read-only', async () => {
    const detail = makeCaseDetail({ escalation: makeEscalation() })
    setup(detail, 'supervision')
    const card = await screen.findByRole('region', { name: 'Escalamiento a supervisión' })
    expect(within(card).getByText('Daniela Ríos:')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Retirar escalamiento' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Entendido' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Escalar a supervisión' })).toBeNull()
  })
})
