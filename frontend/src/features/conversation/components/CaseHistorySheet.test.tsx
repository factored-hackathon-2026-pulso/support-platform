import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import {
  JULIAN_CASE_ID,
  PATRICIA_CASE_ID,
  julianTurns,
  makeHistoryItem,
  makeJulianDetail,
  patriciaHistory,
} from '@/test/conversation-fixtures'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import * as api from '../api'
import { CaseHistorySheet } from './CaseHistorySheet'

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

const onClose = vi.fn<() => void>()

/** Controlled like the Workspace does it through `?previous=`. */
function Harness({ initial = 'list' }: { initial?: string }) {
  const [selected, setSelected] = useState(initial)
  return (
    <CaseHistorySheet
      caseId={PATRICIA_CASE_ID}
      customerName="Patricia Lozano Vega"
      selected={selected}
      onSelect={setSelected}
      onClose={onClose}
    />
  )
}

/** Opened from a trigger, like "Casos anteriores (n)" in the case header. */
function TriggerHarness() {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <>
      <button type="button" onClick={() => setSelected('list')}>
        Casos anteriores (2)
      </button>
      {selected ? (
        <CaseHistorySheet
          caseId={PATRICIA_CASE_ID}
          customerName="Patricia Lozano Vega"
          selected={selected}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  )
}

function renderSheet(initial?: string) {
  return renderWithProviders(<Harness initial={initial} />, { staff: analystStaff })
}

beforeEach(() => {
  vi.mocked(api.fetchCaseHistory).mockResolvedValue(patriciaHistory)
  vi.mocked(api.fetchCaseDetail).mockResolvedValue(makeJulianDetail())
  vi.mocked(api.fetchTurns).mockResolvedValue({
    items: julianTurns(),
    olderCursor: null,
    lastSequence: 3,
  })
})

describe('CaseHistorySheet', () => {
  it("lists the customer's other cases, newest first, and reads one, then goes back", async () => {
    const { user } = renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Casos anteriores de Patricia' })
    expect(sheet).toHaveAccessibleDescription(
      'Conversaciones que tuvo con el equipo. Solo lectura.',
    )
    const list = await within(sheet).findByRole('list', { name: 'Casos anteriores' })
    const rows = within(list).getAllByRole('button')
    // Short facts (slice 6): the reason with its icon, [calendar] date, [user] who.
    expect(rows.map((row) => row.textContent)).toEqual([
      // Slice 7: and the customer's rating when there is one (slice 8: the face alone;
      // its name "Calificación: …" is the tooltip and the accessible text).
      // (the accessible text, then the tooltip bubble: the row shows only the face).
      'ResueltoAbierto: 3 mar 2026Daniela RíosCalificación: ExcelenteCalificación: ExcelentePerfecto, muchas gracias.',
      'ResueltoAbierto: 13 feb 2026Julián OrtegaCalificación: BienCalificación: BienAh, es cierto. Gracias.',
    ])
    expect(rows[0]!.querySelector('[data-reason="resolved"]')).toBeInTheDocument()
    expect(api.fetchCaseHistory).toHaveBeenCalledWith(PATRICIA_CASE_ID, expect.anything())

    await user.click(rows[1]!)
    expect(
      await within(sheet).findByRole('heading', {
        name: 'Caso CASE-…0110',
      }),
    ).toBeInTheDocument()
    expect(api.fetchCaseDetail).toHaveBeenCalledWith(JULIAN_CASE_ID, expect.anything())
    const messages = await within(sheet).findByRole('list', { name: 'Mensajes del caso anterior' })
    expect(within(messages).getByText(/Soy Julián, de LATAM Bank/)).toBeInTheDocument()
    // Read-only: no composer, no read cursor.
    expect(within(sheet).queryByRole('textbox')).not.toBeInTheDocument()
    expect(api.markCaseRead).not.toHaveBeenCalled()

    await user.click(within(sheet).getByRole('button', { name: 'Todos los casos anteriores' }))
    expect(await within(sheet).findByRole('list', { name: 'Casos anteriores' })).toBeInTheDocument()
  })

  it('opens straight on a past case (?previous=<id>)', async () => {
    renderSheet(JULIAN_CASE_ID)
    expect(await screen.findByText(/Soy Julián, de LATAM Bank/)).toBeInTheDocument()
    expect(api.fetchCaseHistory).not.toHaveBeenCalled()
  })

  it('says when there are no other cases and when the list was capped', async () => {
    vi.mocked(api.fetchCaseHistory).mockResolvedValueOnce({ items: [], total: 0 })
    const { unmount } = renderSheet()
    expect(await screen.findByText('No tiene otros casos.')).toBeInTheDocument()
    unmount()
    vi.mocked(api.fetchCaseHistory).mockResolvedValueOnce({
      items: [makeHistoryItem()],
      total: 21,
    })
    renderSheet()
    expect(await screen.findByText('Se muestran los 20 más recientes.')).toBeInTheDocument()
  })

  it('explains a past case it cannot open', async () => {
    vi.mocked(api.fetchCaseDetail).mockRejectedValue(
      new ApiProblem({ status: 403, code: 'case_not_assigned' }),
    )
    renderSheet(JULIAN_CASE_ID)
    expect(await screen.findByText('No tienes acceso a este caso')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todos los casos anteriores' })).toBeInTheDocument()
  })

  it('moves the focus on every list ↔ transcript switch and returns it to the trigger', async () => {
    const { user } = renderWithProviders(<TriggerHarness />, { staff: analystStaff })
    const trigger = screen.getByRole('button', { name: 'Casos anteriores (2)' })
    await user.click(trigger)
    const sheet = screen.getByRole('dialog', { name: 'Casos anteriores de Patricia' })
    const list = await within(sheet).findByRole('list', { name: 'Casos anteriores' })
    const julianRow = within(list).getAllByRole('button')[1]!

    await user.click(julianRow)
    const heading = await within(sheet).findByRole('heading', { name: /Caso CASE-…0110/ })
    expect(heading).toHaveFocus()

    await user.click(within(sheet).getByRole('button', { name: 'Todos los casos anteriores' }))
    const rows = within(
      await within(sheet).findByRole('list', { name: 'Casos anteriores' }),
    ).getAllByRole('button')
    // Back on the row of the case it came from.
    expect(rows[1]).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(await within(sheet).findByRole('heading', { name: /Caso CASE-…0110/ })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('leaves the initial focus to the sheet when it opens straight on a past case', async () => {
    renderSheet(JULIAN_CASE_ID)
    const heading = await screen.findByRole('heading', { name: /Caso CASE-…0110/ })
    expect(heading).not.toHaveFocus()
  })

  it('says when the older messages of a past case could not load', async () => {
    vi.mocked(api.fetchTurns).mockImplementation((_caseId, query = {}) =>
      'cursor' in query && query.cursor
        ? Promise.reject(ApiProblem.network())
        : Promise.resolve({ items: julianTurns(), olderCursor: 'older-1', lastSequence: 3 }),
    )
    const { user } = renderSheet(JULIAN_CASE_ID)
    await user.click(await screen.findByRole('button', { name: 'Cargar mensajes anteriores' }))
    const sheet = screen.getByRole('dialog')
    expect(
      await within(sheet).findByText(
        'No pudimos cargar los mensajes anteriores. Inténtalo de nuevo.',
      ),
    ).toHaveAttribute('role', 'alert')
  })

  it('closes with Escape', async () => {
    const { user } = renderSheet()
    await screen.findByRole('list', { name: 'Casos anteriores' })
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('CaseHistorySheet in Portuguese (slice 23)', () => {
  it('lists the other cases, reads one and goes back', async () => {
    const { user } = renderWithProviders(<Harness />, { staff: analystStaff, locale: 'pt-BR' })
    const sheet = screen.getByRole('dialog', { name: 'Casos anteriores de Patricia' })
    expect(sheet).toHaveAccessibleDescription('Conversas que teve com a equipe. Somente leitura.')
    const list = await within(sheet).findByRole('list', { name: 'Casos anteriores' })
    await user.click(within(list).getAllByRole('button')[1]!)
    expect(
      await within(sheet).findByRole('heading', { name: 'Caso CASE-…0110' }),
    ).toBeInTheDocument()
    const messages = await within(sheet).findByRole('list', { name: 'Mensagens do caso anterior' })
    // The analyst's own turns are "Você" for her; the transcript itself is never translated.
    expect(within(messages).getByText(/Soy Julián, de LATAM Bank/)).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Todos os casos anteriores' }))
    expect(await within(sheet).findByRole('list', { name: 'Casos anteriores' })).toBeInTheDocument()
  })

  it('says when there are no other cases', async () => {
    vi.mocked(api.fetchCaseHistory).mockResolvedValueOnce({ items: [], total: 0 })
    renderWithProviders(<Harness />, { staff: analystStaff, locale: 'pt-BR' })
    expect(await screen.findByText('Não tem outros casos.')).toBeInTheDocument()
  })
})
