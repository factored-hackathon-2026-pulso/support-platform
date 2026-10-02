import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { CASE_ID, makeCaseDetail, stop } from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import { RoutingSummary } from './RoutingSummary'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return { ...actual, fetchCaseDetail: vi.fn<typeof actual.fetchCaseDetail>() }
})

describe('RoutingSummary', () => {
  it('shows the route line and expands into every stop', async () => {
    vi.mocked(api.fetchCaseDetail).mockResolvedValue(makeCaseDetail())
    const { user } = renderWithProviders(<RoutingSummary caseId={CASE_ID} />, {
      staff: analystStaff,
    })

    const toggle = await screen.findByRole('button', { name: /Cómo llegó a ti/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Juez → árbol → agente de IA → tú')).toBeInTheDocument()
    expect(screen.queryByText('Juez de entrada')).not.toBeVisible()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Juez de entrada')).toBeVisible()
    expect(
      screen.getAllByText('Todavía no hay uno conectado: pasó el caso sin atenderlo.'),
    ).toHaveLength(3)
    expect(
      screen.getByText('Te llegó porque estás disponible y hablas español.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Ningún nivel automático leyó datos del cliente.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ocultar/ })).toBeInTheDocument()
  })

  it('starts open for the canvas "recorrido" state, with seeded summaries', async () => {
    vi.mocked(api.fetchCaseDetail).mockResolvedValue(
      makeCaseDetail({
        routing: {
          stops: [
            stop({
              kind: 'entry',
              label: 'IVR',
              summary: 'Verificó su identidad con documento y clave.',
            }),
            stop({ kind: 'queue', label: 'Cola de disputas', waitedSeconds: 133 }),
            stop({ kind: 'assignee', label: 'Daniela Ríos', staffId: analystStaff.id }),
          ],
          inputsUsed: ['customers', 'transactions'],
        },
      }),
    )
    renderWithProviders(<RoutingSummary caseId={CASE_ID} defaultOpen />, { staff: analystStaff })
    expect(await screen.findByText('IVR → cola de disputas → tú')).toBeInTheDocument()
    expect(screen.getByText('Verificó su identidad con documento y clave.')).toBeVisible()
    expect(screen.getByText('Esperó 2 min 13 s.')).toBeVisible()
    expect(screen.getByText('Usaron su ficha y sus movimientos.')).toBeVisible()
  })

  it('says so when the route cannot be loaded', async () => {
    vi.mocked(api.fetchCaseDetail).mockRejectedValue(ApiProblem.network())
    renderWithProviders(<RoutingSummary caseId={CASE_ID} />, { staff: analystStaff })
    expect(await screen.findByText('No pudimos cargar cómo llegó el caso.')).toBeInTheDocument()
  })
})
