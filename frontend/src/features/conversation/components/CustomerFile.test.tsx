import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SidePanel } from '@/components/layout'
import { ApiProblem } from '@/lib/api'
import {
  JULIAN_CASE_ID,
  julianTurns,
  makeCaseDetail,
  makeClosedDetail,
  makeJulianDetail,
  patriciaHistory,
  seededTurns,
} from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import type { CaseDetail } from '../types'
import { ConversationPane } from './ConversationPane'
import { CustomerFile } from './CustomerFile'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    fetchCaseDetail: vi.fn<typeof actual.fetchCaseDetail>(),
    fetchTurns: vi.fn<typeof actual.fetchTurns>(),
    fetchCaseHistory: vi.fn<typeof actual.fetchCaseHistory>(),
    markCaseRead: vi.fn<typeof actual.markCaseRead>(),
  }
})

const DETAIL = makeCaseDetail({ previousCaseCount: 2 })

beforeEach(() => {
  vi.mocked(api.fetchCaseDetail).mockImplementation(async (caseId) =>
    caseId === JULIAN_CASE_ID ? makeJulianDetail() : DETAIL,
  )
  vi.mocked(api.fetchTurns).mockImplementation(async (caseId) => ({
    items: caseId === JULIAN_CASE_ID ? julianTurns() : seededTurns(),
    olderCursor: null,
    lastSequence: 4,
  }))
  vi.mocked(api.fetchCaseHistory).mockResolvedValue(patriciaHistory)
  vi.mocked(api.markCaseRead).mockResolvedValue(DETAIL.case)
})

/** The Workspace wiring in small: the slim header toggles the panel with the sections. */
function Harness({ detail = DETAIL }: { detail?: CaseDetail }) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<string | null>(null)
  return (
    <div>
      <ConversationPane
        caseId={detail.case.id}
        customerFile={{ open, onToggle: () => setOpen((value) => !value) }}
      />
      {open ? (
        <SidePanel
          id="ficha-del-cliente"
          title="Ficha del cliente"
          closeLabel="Cerrar la ficha del cliente"
          onClose={() => setOpen(false)}
          focusOnOpen
          returnFocusTo="ficha-del-cliente-boton"
        >
          <CustomerFile caseId={detail.case.id} history={history} onHistoryChange={setHistory} />
        </SidePanel>
      ) : null}
    </div>
  )
}

describe('slim case header (Workspace)', () => {
  it('shows only the name, a button to the file, and the case number', async () => {
    renderWithProviders(<Harness />, { staff: analystStaff })
    const heading = await screen.findByRole('heading', { level: 2, name: 'Marcela Quintana Pardo' })
    const trigger = within(heading).getByRole('button', {
      name: 'Ver ficha de Marcela Quintana Pardo',
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('id', 'ficha-del-cliente-boton')
    expect(screen.getByText(DETAIL.case.id)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copiar número de caso' })).toBeInTheDocument()
    // The meta line and "Casos anteriores (n)" moved into the panel.
    expect(screen.queryByText(/Colombia · Barranquilla/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Casos anteriores/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar caso' })).toBeInTheDocument()
  })
})

describe('CustomerFile ("Ficha del cliente")', () => {
  it('opens from the name with the customer, this case and the previous cases', async () => {
    const { user } = renderWithProviders(<Harness />, { staff: analystStaff })
    const trigger = await screen.findByRole('button', {
      name: 'Ver ficha de Marcela Quintana Pardo',
    })
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', 'ficha-del-cliente')
    const panel = screen.getByRole('complementary', { name: 'Ficha del cliente' })
    expect(
      within(panel).getByRole('heading', { level: 2, name: 'Ficha del cliente' }),
    ).toHaveFocus()

    const customer = within(panel).getByRole('region', { name: 'Cliente' })
    // One fact per row, each label with its icon; no dot-joined values.
    expect(customer).toHaveTextContent('CiudadBarranquilla, Colombia')
    expect(customer).toHaveTextContent('IdiomaEspañol')
    expect(customer).toHaveTextContent('CUS-00000000000000000000001001')
    expect(customer.querySelectorAll('dt svg')).toHaveLength(4)
    expect(panel.textContent).not.toContain('·')
    const thisCase = within(panel).getByRole('region', { name: 'Este caso' })
    expect(thisCase).toHaveTextContent('CanalChat web')
    expect(thisCase).toHaveTextContent('PrioridadMedia')
    const status = within(thisCase).getByText('Por responder').parentElement!
    expect(status).not.toHaveClass('bg-warn-soft')
    expect(status.querySelector('svg')).toHaveAttribute('data-status-shape', 'pie-75')
    expect(thisCase).toHaveTextContent('Primera respuestaA tiempo')
    const arrival = within(panel).getByRole('region', { name: 'Cómo llegó a ti' })
    expect(
      within(arrival)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Estabas disponible', 'Hablas español'])
    expect(arrival).toHaveTextContent('Asignado: 5 mar, 10:46')

    const previous = within(panel).getByRole('region', { name: 'Casos anteriores (2)' })
    const list = await within(previous).findByRole('list', { name: 'Casos anteriores' })
    // Each closed case shows its reason's icon and tone.
    expect(list.querySelectorAll('[data-reason="resolved"]')).toHaveLength(2)
    // …and how the customer rated it (slice 7).
    expect(within(list).getByRole('button', { name: /Daniela Ríos/ })).toHaveTextContent(
      'Calificó: Excelente',
    )
    expect(within(list).getByRole('button', { name: /Julián Ortega/ })).toHaveTextContent(
      'Calificó: Bien',
    )
    await user.click(within(list).getByRole('button', { name: /Julián Ortega/ }))
    expect(
      await within(previous).findByRole('heading', { level: 4, name: /^Caso CASE-…0110/ }),
    ).toHaveFocus()
    expect(
      await within(previous).findByRole('list', { name: 'Mensajes del caso anterior' }),
    ).toBeInTheDocument()
    // Read-only: no composer in the panel.
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
    await user.click(within(previous).getByRole('button', { name: 'Todos los casos anteriores' }))
    expect(
      await within(previous).findByRole('list', { name: 'Casos anteriores' }),
    ).toBeInTheDocument()
  })

  it('adds "Calificación" to a closed case: the face pill or "Sin calificar" (slice 7)', async () => {
    const closed = makeClosedDetail()
    vi.mocked(api.fetchCaseDetail).mockResolvedValue(closed)
    const { user, unmount } = renderWithProviders(<Harness detail={closed} />, {
      staff: analystStaff,
    })
    await user.click(await screen.findByRole('button', { name: /Ver ficha de/ }))
    let thisCase = within(
      screen.getByRole('complementary', { name: 'Ficha del cliente' }),
    ).getByRole('region', { name: 'Este caso' })
    expect(thisCase).toHaveTextContent('CalificaciónSin calificar')
    expect(within(thisCase).getByText('Sin calificar')).toHaveClass('bg-panel')
    unmount()

    const rated = {
      ...closed,
      case: {
        ...closed.case,
        rating: { score: 4, comment: null, ratedAt: '2026-03-05T16:05:00Z' },
      },
    }
    vi.mocked(api.fetchCaseDetail).mockResolvedValue(rated)
    const second = renderWithProviders(<Harness detail={rated} />, { staff: analystStaff })
    await second.user.click(await screen.findByRole('button', { name: /Ver ficha de/ }))
    thisCase = within(screen.getByRole('complementary', { name: 'Ficha del cliente' })).getByRole(
      'region',
      { name: 'Este caso' },
    )
    const pill = within(thisCase).getByText('Excelente')
    expect(pill).toHaveClass('bg-success-soft')
    expect(pill.querySelector('.lucide-laugh')).not.toBeNull()
  })

  it('has no "Calificación" row while the case is open (slice 7)', async () => {
    const { user } = renderWithProviders(<Harness />, { staff: analystStaff })
    await user.click(await screen.findByRole('button', { name: /Ver ficha de/ }))
    const thisCase = within(
      screen.getByRole('complementary', { name: 'Ficha del cliente' }),
    ).getByRole('region', { name: 'Este caso' })
    expect(thisCase).not.toHaveTextContent('Calificación')
  })

  it('closes with Escape inside the panel and gives the focus back to the name', async () => {
    const { user } = renderWithProviders(<Harness />, { staff: analystStaff })
    const trigger = await screen.findByRole('button', {
      name: 'Ver ficha de Marcela Quintana Pardo',
    })
    await user.click(trigger)
    await screen.findByRole('complementary', { name: 'Ficha del cliente' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    await vi.waitFor(() => expect(trigger).toHaveFocus())

    await user.click(trigger)
    const panel = await screen.findByRole('complementary', { name: 'Ficha del cliente' })
    await user.click(within(panel).getByRole('button', { name: 'Cerrar la ficha del cliente' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('keeps the conversation usable and ignores Escape typed outside the panel', async () => {
    const { user } = renderWithProviders(<Harness />, { staff: analystStaff })
    await user.click(
      await screen.findByRole('button', { name: 'Ver ficha de Marcela Quintana Pardo' }),
    )
    const composer = await screen.findByRole('textbox', { name: 'Escribe al cliente' })
    await user.click(composer)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('complementary', { name: 'Ficha del cliente' })).toBeInTheDocument()
  })

  it('shows the load error with a retry', async () => {
    vi.mocked(api.fetchCaseDetail).mockRejectedValue(ApiProblem.network())
    renderWithProviders(
      <CustomerFile caseId={DETAIL.case.id} history={null} onHistoryChange={() => {}} />,
      { staff: analystStaff },
    )
    expect(await screen.findByText('No pudimos cargar la conversación')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
