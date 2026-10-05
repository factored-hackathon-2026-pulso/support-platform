import { useState } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
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
import type { CaseDetail, CasePriorityResult, CaseTypeResult } from '../types'
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
    changeCasePriority: vi.fn<typeof actual.changeCasePriority>(),
    changeCaseType: vi.fn<typeof actual.changeCaseType>(),
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
    // The language: the globe and only its own name, no code.
    expect(customer).toHaveTextContent('IdiomaEspañol')
    expect(customer.querySelector('dd [data-language="es"] svg.lucide-globe')).not.toBeNull()
    expect(customer).toHaveTextContent('CUS-00000000000000000000001001')
    expect(customer.querySelectorAll('dt svg')).toHaveLength(4)
    expect(panel.textContent).not.toContain('·')
    const thisCase = within(panel).getByRole('region', { name: 'Este caso' })
    expect(thisCase).toHaveTextContent('CanalChat web')
    // Slice 8: the priority is a menu button (the assignee may change it).
    expect(
      within(thisCase).getByRole('button', {
        name: 'Prioridad: Media. Cambiar la prioridad',
      }),
    ).toHaveTextContent('Media')
    const status = within(thisCase).getByText('Por responder').parentElement!
    expect(status).not.toHaveClass('bg-warn-soft')
    expect(status.querySelector('svg')).toHaveAttribute('data-status-shape', 'pie-75')
    expect(thisCase).toHaveTextContent('Primera respuestaA tiempo')
    const arrival = within(panel).getByRole('region', { name: 'Cómo llegó a ti' })
    expect(
      within(arrival)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Estabas disponible', expect.stringMatching(/^HablasEspañolES/)])
    expect(arrival).toHaveTextContent('Asignado: 5 mar, 10:46')

    const previous = within(panel).getByRole('region', { name: 'Casos anteriores (2)' })
    const list = await within(previous).findByRole('list', { name: 'Casos anteriores' })
    // Each closed case shows its reason's icon and tone.
    expect(list.querySelectorAll('[data-reason="resolved"]')).toHaveLength(2)
    // …and how the customer rated it (slice 7).
    // Slice 8: the face alone, named "Calificación: …" (tooltip and accessible text).
    const danielaCase = within(list).getByRole('button', { name: /Daniela Ríos/ })
    expect(danielaCase).toHaveAccessibleName(/Calificación: Excelente/)
    expect(danielaCase).not.toHaveTextContent(/Calificó/)
    expect(within(list).getByRole('button', { name: /Julián Ortega/ })).toHaveAccessibleName(
      /Calificación: Bien/,
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

describe('priority in "Este caso" (slice 8)', () => {
  async function openFile() {
    const rendered = renderWithProviders(<Harness />, { staff: analystStaff })
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Ver ficha de Marcela Quintana Pardo' }),
    )
    const thisCase = screen.getByRole('region', { name: 'Este caso' })
    return { ...rendered, thisCase }
  }

  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('changes it from the menu with the keyboard, at once and then from the server', async () => {
    const answer = deferred<CasePriorityResult>()
    vi.mocked(api.changeCasePriority).mockReturnValue(answer.promise)
    const { user, thisCase } = await openFile()
    const trigger = within(thisCase).getByRole('button', {
      name: 'Prioridad: Media. Cambiar la prioridad',
    })
    expect(trigger.querySelector('svg[data-priority="medium"]')).not.toBeNull()
    trigger.focus()
    await user.keyboard('{Enter}')
    const menu = screen.getByRole('menu', { name: 'Prioridad' })
    expect(within(menu).getByRole('menuitemradio', { name: 'Media' })).toHaveFocus()
    expect(within(menu).getByRole('menuitemradio', { name: 'Media' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.keyboard('{ArrowUp}{Enter}')
    expect(api.changeCasePriority).toHaveBeenCalledWith(DETAIL.case.id, {
      priority: 'high',
      expectedVersion: DETAIL.case.version,
    })
    // Optimistic: the new level shows before the server answers, and the focus is back.
    const changed = within(thisCase).getByRole('button', {
      name: 'Prioridad: Alta. Cambiar la prioridad',
    })
    expect(changed).toHaveFocus()
    answer.resolve({
      changed: true,
      case: { ...DETAIL.case, priority: 'high', version: DETAIL.case.version + 1 },
    })
    await waitFor(() => expect(api.changeCasePriority).toHaveBeenCalledTimes(1))
    expect(
      within(thisCase).getByRole('button', { name: 'Prioridad: Alta. Cambiar la prioridad' }),
    ).toBeInTheDocument()
    // The panel stayed open (Escape and Enter stayed inside the menu).
    expect(screen.getByRole('complementary', { name: 'Ficha del cliente' })).toBeInTheDocument()
  })

  it('puts the previous level back and says why when the change fails', async () => {
    vi.mocked(api.changeCasePriority).mockRejectedValue(
      new ApiProblem({ status: 409, code: 'case_closed' }),
    )
    const { user, thisCase } = await openFile()
    await user.click(
      within(thisCase).getByRole('button', { name: 'Prioridad: Media. Cambiar la prioridad' }),
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'Crítica' }))
    expect(
      await within(thisCase).findByRole('button', {
        name: 'Prioridad: Media. Cambiar la prioridad',
      }),
    ).toBeInTheDocument()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No pudimos cambiar la prioridad')
    expect(alert).toHaveTextContent('El caso ya está cerrado.')
  })

  it('sends it once more when only the version moved (a message arrived meanwhile)', async () => {
    const moved = { ...DETAIL.case, version: DETAIL.case.version + 2 }
    vi.mocked(api.changeCasePriority)
      .mockRejectedValueOnce(
        new ApiProblem({ status: 409, code: 'version_conflict', extensions: { current: moved } }),
      )
      .mockResolvedValueOnce({
        changed: true,
        case: { ...moved, priority: 'low', version: moved.version + 1 },
      })
    const { user, thisCase } = await openFile()
    await user.click(
      within(thisCase).getByRole('button', { name: 'Prioridad: Media. Cambiar la prioridad' }),
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'Baja' }))
    await waitFor(() => expect(api.changeCasePriority).toHaveBeenCalledTimes(2))
    expect(api.changeCasePriority).toHaveBeenLastCalledWith(DETAIL.case.id, {
      priority: 'low',
      expectedVersion: moved.version,
    })
    expect(
      await within(thisCase).findByRole('button', {
        name: 'Prioridad: Baja. Cambiar la prioridad',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('No pudimos cambiar la prioridad')).not.toBeInTheDocument()
  })

  it("shows someone else's change after a real conflict", async () => {
    const theirs = {
      ...DETAIL.case,
      priority: 'critical' as const,
      version: DETAIL.case.version + 1,
    }
    vi.mocked(api.changeCasePriority).mockRejectedValue(
      new ApiProblem({ status: 409, code: 'version_conflict', extensions: { current: theirs } }),
    )
    const { user, thisCase } = await openFile()
    await user.click(
      within(thisCase).getByRole('button', { name: 'Prioridad: Media. Cambiar la prioridad' }),
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'Baja' }))
    expect(
      await within(thisCase).findByRole('button', {
        name: 'Prioridad: Crítica. Cambiar la prioridad',
      }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Alguien más la cambió: ahora es Crítica.',
    )
    expect(api.changeCasePriority).toHaveBeenCalledTimes(1)
  })

  it('is glyph and word, no menu, when the viewer may not change it', async () => {
    vi.mocked(api.fetchCaseDetail).mockResolvedValue({
      ...makeClosedDetail(),
      case: { ...makeClosedDetail().case, priority: 'high' },
    })
    const { thisCase } = await openFile()
    expect(within(thisCase).queryByRole('button', { name: /Prioridad/ })).not.toBeInTheDocument()
    expect(thisCase).toHaveTextContent('PrioridadAlta')
    expect(thisCase.querySelector('svg[data-priority="high"]')).not.toBeNull()
  })
})

describe('case type in "Este caso" (slice 18)', () => {
  async function openFile(aiEnabled: boolean) {
    const rendered = renderWithProviders(<Harness />, { staff: analystStaff, aiEnabled })
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Ver ficha de Marcela Quintana Pardo' }),
    )
    const thisCase = screen.getByRole('region', { name: 'Este caso' })
    return { ...rendered, thisCase }
  }

  it('is not there while the AI switch is off (the people-only ficha)', async () => {
    const { thisCase } = await openFile(false)
    expect(within(thisCase).queryByText('Tipo de caso')).not.toBeInTheDocument()
    expect(within(thisCase).queryByRole('button', { name: /^Tipo de caso:/ })).toBeNull()
  })

  it('changes it from the menu, at once and then from the server', async () => {
    let resolve!: (value: CaseTypeResult) => void
    vi.mocked(api.changeCaseType).mockReturnValue(
      new Promise<CaseTypeResult>((res) => {
        resolve = res
      }),
    )
    const { user, thisCase } = await openFile(true)
    expect(within(thisCase).getByText('Tipo de caso')).toBeInTheDocument()
    await user.click(
      within(thisCase).getByRole('button', {
        name: 'Tipo de caso: Sin tipo. Cambiar el tipo de caso',
      }),
    )
    const menu = screen.getByRole('menu', { name: 'Tipo de caso' })
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual([
      'Sin tipo',
      'Cargo no reconocido',
      'Cobro indebido',
      'Problema con app',
      'Atención en sucursal',
      'Calidad de servicio',
      'Tarjeta virtual',
    ])
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Cobro indebido' }))
    expect(api.changeCaseType).toHaveBeenCalledWith(DETAIL.case.id, {
      caseType: 'undue_charge',
      expectedVersion: DETAIL.case.version,
    })
    expect(
      within(thisCase).getByRole('button', {
        name: 'Tipo de caso: Cobro indebido. Cambiar el tipo de caso',
      }),
    ).toBeInTheDocument()
    resolve({
      changed: true,
      case: { ...DETAIL.case, caseType: 'undue_charge', version: DETAIL.case.version + 1 },
    })
    await waitFor(() => expect(api.changeCaseType).toHaveBeenCalledTimes(1))
  })

  it('puts the previous type back and says why when the change fails', async () => {
    vi.mocked(api.changeCaseType).mockRejectedValue(
      new ApiProblem({ status: 403, code: 'case_not_assigned' }),
    )
    const { user, thisCase } = await openFile(true)
    await user.click(
      within(thisCase).getByRole('button', {
        name: 'Tipo de caso: Sin tipo. Cambiar el tipo de caso',
      }),
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'Problema con app' }))
    expect(
      await within(thisCase).findByRole('button', {
        name: 'Tipo de caso: Sin tipo. Cambiar el tipo de caso',
      }),
    ).toBeInTheDocument()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No pudimos cambiar el tipo de caso')
    expect(alert).toHaveTextContent('Ya no puedes cambiar el tipo de este caso.')
  })
})

describe('CustomerFile in Portuguese (slice 23)', () => {
  it('opens from the name with the customer, this case, how it arrived and the past cases', async () => {
    const { user } = renderWithProviders(<Harness />, { staff: analystStaff, locale: 'pt-BR' })
    await user.click(
      await screen.findByRole('button', { name: 'Ver ficha de Marcela Quintana Pardo' }),
    )
    expect(screen.getByRole('button', { name: 'Copiar número do caso' })).toBeInTheDocument()
    const customer = await screen.findByRole('region', { name: 'Cliente' })
    expect(customer).toHaveTextContent('Cidade')
    expect(customer).toHaveTextContent('ID do cliente')
    const thisCase = screen.getByRole('region', { name: 'Este caso' })
    expect(thisCase).toHaveTextContent('Primeira respostaNo prazo')
    const arrival = screen.getByRole('region', { name: 'Como chegou até você' })
    expect(arrival).toHaveTextContent('Você estava disponível')
    expect(arrival).toHaveTextContent('Atribuído')
    const previous = screen.getByRole('region', { name: 'Casos anteriores (2)' })
    const list = await within(previous).findByRole('list', { name: 'Casos anteriores' })
    await user.click(within(list).getByRole('button', { name: /Julián Ortega/ }))
    expect(
      await within(previous).findByRole('heading', { level: 4, name: /^Caso CASE-…0110/ }),
    ).toHaveFocus()
    expect(
      await within(previous).findByRole('list', { name: 'Mensagens do caso anterior' }),
    ).toBeInTheDocument()
    expect(previous).toHaveTextContent('Encerrado:')
    await user.click(within(previous).getByRole('button', { name: 'Todos os casos anteriores' }))
    expect(
      await within(previous).findByRole('list', { name: 'Casos anteriores' }),
    ).toBeInTheDocument()
  })
})
