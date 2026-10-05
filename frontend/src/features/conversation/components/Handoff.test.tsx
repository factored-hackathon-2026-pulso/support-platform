import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import {
  makeCaseDetail,
  makeClosedDetail,
  makeTurn,
  seededTurns,
} from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import type { CaseDetail } from '../types'
import { ConversationPane } from './ConversationPane'
import { HandoffPanel } from './Handoff'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchCaseDetail: vi.fn<typeof actual.fetchCaseDetail>(),
    fetchTurns: vi.fn<typeof actual.fetchTurns>(),
    markCaseRead: vi.fn<typeof actual.markCaseRead>(),
    fetchCaseHandoff: vi.fn<typeof actual.fetchCaseHandoff>(),
    closeCase: vi.fn<typeof actual.closeCase>(),
  }
})

/** Marcela's case, handed to Daniela by the assistant. */
function handoffDetail(): CaseDetail {
  const detail = makeCaseDetail()
  return { ...detail, assignment: { ...detail.assignment!, reason: 'assistant_handoff' } }
}

const PACKET = {
  handoff_ref: 'hnd-7',
  target_queue: 'disputas',
  priority: 'critical',
  reason_code: 'policy:posible_fraude',
  request_summary: { text: 'Una política exigió atención humana.', citations: [] },
  verified_facts: [
    { fact_id: 'f1', name: 'identity_verified', value: true, source: { kind: 'identity' } },
    { fact_id: 'f2', name: 'charge_amount', value: 120, source: { kind: 'tool' } },
  ],
  claimed_not_verified: [{ name: 'card_stolen', value: 'ayer', source_turn: 1 }],
  actions_taken: [{ action_id: 'a1', tool: 'radicar_disputa@1.0.0', state: 'verified' }],
  open_questions: ['¿Hay más cargos desde ayer?'],
}

const assistantTurn = makeTurn({
  sequence: 5,
  authorRole: 'assistant',
  authorId: 'recepcion@1.0.0',
  authorName: 'Asistente virtual',
  text: 'Listo, radiqué la disputa por 120 USD.',
})
const banner = makeTurn({
  sequence: 6,
  kind: 'routing',
  audience: 'staff',
  authorRole: 'system',
  authorId: null,
  authorName: null,
  text: 'El asistente escaló el caso a una persona (traspaso hnd-7).',
})

beforeEach(() => {
  vi.mocked(api.fetchCaseDetail).mockResolvedValue(handoffDetail())
  vi.mocked(api.fetchTurns).mockResolvedValue({
    items: [...seededTurns(), assistantTurn, banner],
    olderCursor: null,
    lastSequence: 6,
  })
  vi.mocked(api.markCaseRead).mockResolvedValue(handoffDetail().case)
  vi.mocked(api.fetchCaseHandoff).mockReset()
  vi.mocked(api.fetchCaseHandoff).mockResolvedValue({ packet: PACKET })
  vi.mocked(api.closeCase).mockReset()
})

function renderPane({ aiEnabled = true }: { aiEnabled?: boolean } = {}) {
  const onOpenHandoff = vi.fn<() => void>()
  const view = renderWithProviders(
    <ConversationPane caseId={handoffDetail().case.id} onOpenHandoff={onOpenHandoff} />,
    { staff: analystStaff, aiEnabled },
  )
  return { ...view, onOpenHandoff }
}

describe('the assistant in the analyst conversation (slice 19)', () => {
  it('shows its turns in a pale blue bubble and the staff-only banner', async () => {
    renderPane()
    const text = await screen.findByText('Listo, radiqué la disputa por 120 USD.')
    const bubble = text.closest('div')
    expect(bubble).toHaveClass('bg-assistant-bubble', 'border-accent-border')
    expect(bubble).toHaveTextContent('Asistente virtual: Listo')
    expect(
      screen.getByText('El asistente escaló el caso a una persona (traspaso hnd-7).'),
    ).toBeInTheDocument()
  })

  it('explains how it arrived and leads the handoff card with why, priority and queue', async () => {
    const { user, onOpenHandoff } = renderPane()
    expect(await screen.findByText('Tras el traspaso del asistente')).toBeInTheDocument()
    const card = await screen.findByRole('region', { name: 'El asistente te pasó este caso' })
    expect(within(card).getByText('Solo el equipo')).toBeInTheDocument()
    expect(card).toHaveTextContent(
      'Por qué te lo pasó: Una política pide que lo atienda una persona (Posible fraude)',
    )
    expect(card).toHaveTextContent('Prioridad que vio el asistente: Crítica')
    expect(card).toHaveTextContent('Disputas')
    expect(card).toHaveTextContent('2 datos verificados')
    // The generic summary is not what leads.
    expect(card).not.toHaveTextContent('Una política exigió atención humana.')
    expect(card.textContent).not.toContain('·')
    await user.click(
      within(card).getByRole('button', { name: 'Ver todo el traspaso del asistente' }),
    )
    expect(onOpenHandoff).toHaveBeenCalledTimes(1)
    expect(api.fetchCaseHandoff).toHaveBeenCalledTimes(1)
  })

  it('offers a retry when agent-core does not answer, and keeps the conversation', async () => {
    vi.mocked(api.fetchCaseHandoff)
      .mockRejectedValueOnce(new ApiProblem({ status: 503, code: 'agent_core_unavailable' }))
      .mockRejectedValueOnce(new ApiProblem({ status: 503, code: 'agent_core_unavailable' }))
    const { user } = renderPane()
    const card = await screen.findByRole('region', {
      name: 'No pudimos traer el traspaso del asistente',
    })
    expect(card).toHaveTextContent(
      'La conversación sigue disponible. Vuelve a intentarlo en un momento.',
    )
    expect(screen.getByRole('textbox', { name: /Escribe/ })).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Reintentar' }))
    expect(
      await screen.findByRole('region', { name: 'El asistente te pasó este caso' }),
    ).toBeInTheDocument()
  })

  it('shows nothing for a handoff that cannot be read, nor with AI off', async () => {
    vi.mocked(api.fetchCaseHandoff).mockRejectedValue(
      new ApiProblem({ status: 404, code: 'handoff_unavailable' }),
    )
    const { unmount } = renderPane()
    await waitFor(() => expect(api.fetchCaseHandoff).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: /traspaso/i })).not.toBeInTheDocument()
    unmount()

    vi.mocked(api.fetchCaseHandoff).mockClear()
    renderPane({ aiEnabled: false })
    expect(await screen.findByText('Listo, radiqué la disputa por 120 USD.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /traspaso|te pasó/i })).not.toBeInTheDocument()
    expect(api.fetchCaseHandoff).not.toHaveBeenCalled()
  })

  it('asks "¿Te sirvió el traspaso?" at close and sends the answer', async () => {
    vi.mocked(api.closeCase).mockResolvedValue(makeClosedDetail())
    const { user } = renderPane()
    await screen.findByRole('region', { name: 'El asistente te pasó este caso' })
    await user.click(screen.getByRole('button', { name: 'Cerrar caso' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cerrar caso' })
    const group = within(dialog).getByRole('group', {
      name: '¿Te sirvió el traspaso del asistente? (opcional)',
    })
    expect(group).toHaveAccessibleDescription(
      'Se lo enviamos al asistente para que mejore. Si no sabes, déjalo sin marcar.',
    )
    const incomplete = within(group).getByRole('button', { name: /Incompleto/ })
    await user.click(incomplete)
    expect(incomplete).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(dialog).getByRole('radio', { name: 'Resuelto' }))
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar caso' }))
    await waitFor(() =>
      expect(api.closeCase).toHaveBeenCalledWith(handoffDetail().case.id, {
        reason: 'resolved',
        note: null,
        handoffQuality: 'incomplete',
      }),
    )
  })

  it('never asks about the handoff when it did not load', async () => {
    vi.mocked(api.fetchCaseHandoff).mockRejectedValue(
      new ApiProblem({ status: 404, code: 'handoff_unavailable' }),
    )
    vi.mocked(api.closeCase).mockResolvedValue(makeClosedDetail())
    const { user } = renderPane()
    await user.click(await screen.findByRole('button', { name: 'Cerrar caso' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cerrar caso' })
    expect(within(dialog).queryByRole('group', { name: /traspaso/ })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'Resuelto' }))
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar caso' }))
    await waitFor(() =>
      expect(api.closeCase).toHaveBeenCalledWith(handoffDetail().case.id, {
        reason: 'resolved',
        note: null,
      }),
    )
  })
})

describe('HandoffPanel ("Traspaso" tab)', () => {
  it('lists why, what it verified, what was claimed, what it did and what is open', async () => {
    renderWithProviders(<HandoffPanel detail={handoffDetail()} />, {
      staff: analystStaff,
      aiEnabled: true,
    })
    const why = await screen.findByRole('region', { name: 'Por qué te lo pasó' })
    expect(why).toHaveTextContent('Una política pide que lo atienda una persona')
    expect(why).toHaveTextContent('Posible fraude')
    expect(screen.getByRole('region', { name: 'Verificado' })).toHaveTextContent(
      'Identity verified: Sí',
    )
    expect(
      screen.getByRole('region', { name: 'Dice el cliente, sin verificar' }),
    ).toHaveTextContent('Card stolen: ayer')
    expect(screen.getByRole('region', { name: 'Lo que hizo el asistente' })).toHaveTextContent(
      'Radicar disputaHecha y verificada',
    )
    expect(screen.getByRole('region', { name: 'Falta resolver' })).toHaveTextContent(
      '¿Hay más cargos desde ayer?',
    )
    expect(screen.getByRole('region', { name: 'Qué pide' })).toHaveTextContent(
      'Una política exigió atención humana.',
    )
    expect(
      screen.getByText(
        'Lo armó el asistente virtual con su conversación. Revísalo antes de responder.',
      ),
    ).toBeInTheDocument()
  })

  it('says what is missing and retries an outage', async () => {
    vi.mocked(api.fetchCaseHandoff)
      .mockRejectedValueOnce(new ApiProblem({ status: 502, code: 'agent_core_rejected' }))
      .mockRejectedValueOnce(new ApiProblem({ status: 502, code: 'agent_core_rejected' }))
      .mockResolvedValueOnce({ packet: { reason_code: 'customer_request' } })
    const { user } = renderWithProviders(<HandoffPanel detail={handoffDetail()} />, {
      staff: analystStaff,
      aiEnabled: true,
    })
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('El cliente pidió hablar con una persona')).toBeInTheDocument()
    expect(screen.getByText('El asistente no verificó ningún dato.')).toBeInTheDocument()
    expect(screen.getByText('El asistente no dejó un resumen.')).toBeInTheDocument()
  })
})
