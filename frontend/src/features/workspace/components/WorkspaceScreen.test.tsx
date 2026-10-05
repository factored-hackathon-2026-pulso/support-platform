/**
 * The Workspace frame in Portuguese (slice 23): the empty states, the ficha and the right
 * panel's tabs. Its behaviour (selection, URL, focus) is tested in
 * `src/routes/analyst/workspace.test.tsx`; the conversation and the copilot are stubs here.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CasesApi from '@/features/cases/api'
import type * as Copilot from '@/features/copilot'
import type * as NotificationsApi from '@/features/notifications/api'
import { fetchAvailability, fetchInbox, updateAvailability } from '@/features/cases/api'
import { fetchNotifications } from '@/features/notifications/api'
import { NOW, available, emptyInbox, makeInbox } from '@/test/case-fixtures'
import { analystStaff } from '@/test/fixtures'
import { makeNotificationPage } from '@/test/notification-fixtures'
import { renderRoute } from '@/test/render'
import { makeStages } from '@/test/stage-fixtures'

vi.mock('@/features/cases/api', async (importOriginal) => {
  const actual = await importOriginal<typeof CasesApi>()
  return {
    ...actual,
    fetchInbox: vi.fn<typeof actual.fetchInbox>(),
    fetchAvailability: vi.fn<typeof actual.fetchAvailability>(),
    updateAvailability: vi.fn<typeof actual.updateAvailability>(),
  }
})

vi.mock('@/features/notifications/api', async (importOriginal) => {
  const actual = await importOriginal<typeof NotificationsApi>()
  return { ...actual, fetchNotifications: vi.fn<typeof actual.fetchNotifications>() }
})

vi.mock('@/features/copilot', async (importOriginal) => {
  const actual = await importOriginal<typeof Copilot>()
  return {
    ...actual,
    CopilotPanel: ({ caseId }: { caseId: string }) => <p>Copilot {caseId}</p>,
    ToolsPanel: ({ caseId }: { caseId: string }) => <p>Tools {caseId}</p>,
    StageStrip: () => null,
    useCopilotAccess: () => true,
    useCopilotThread: (caseId: string) => ({ data: { caseId, available: true, messages: [] } }),
    useLatestSuggestion: () => ({ data: { available: true, suggestion: null } }),
    useAiStages: () => ({ data: makeStages() }),
  }
})

/** The case the assistant handed over (its "Transferência" tab shows). */
const HANDOFF_CASE = 'CASE-00000000000000000000000102'

vi.mock('@/features/conversation', () => {
  const TRIGGER = 'ficha-del-cliente-boton'
  return {
    CUSTOMER_FILE_PANEL_ID: 'ficha-del-cliente',
    CUSTOMER_FILE_TRIGGER_ID: TRIGGER,
    SUPPORT_PANEL_TRIGGER_ID: 'apoyo-del-caso-boton',
    ConversationPane: ({ caseId }: { caseId: string }) => (
      <section aria-label="Conversation">
        <h2>Conversation {caseId}</h2>
        <button id={TRIGGER} type="button">
          File
        </button>
      </section>
    ),
    CustomerFile: ({ caseId }: { caseId: string }) => <p>File {caseId}</p>,
    HandoffPanel: ({ detail }: { detail: { case: { id: string } } }) => (
      <p>Handoff {detail.case.id}</p>
    ),
    useCaseDetail: (caseId: string) => ({
      data: {
        case: {
          id: caseId,
          status: 'in_progress',
          customer: { displayName: 'Patricia Lozano' },
          caseType: 'undue_charge',
        },
        assignment: null,
      },
    }),
    useCaseHandoff: (detail?: { case: { id: string } }) => ({
      handoff: { status: 'success' },
      available: detail?.case.id === HANDOFF_CASE,
    }),
    describeHandoffFailure: () => ({ title: '', description: '', retry: false }),
  }
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchInbox).mockResolvedValue(makeInbox())
  vi.mocked(fetchAvailability).mockResolvedValue(available)
  vi.mocked(updateAvailability).mockImplementation(async (status) => ({
    status,
    since: NOW.toISOString(),
  }))
  vi.mocked(fetchNotifications).mockResolvedValue(makeNotificationPage([]))
})

afterEach(() => {
  vi.useRealTimers()
})

const renderWorkspace = (entry: string, { aiEnabled = false } = {}) =>
  renderRoute(entry, { staff: analystStaff, aiEnabled, locale: 'pt-BR' })

describe('Workspace in Portuguese (slice 23)', () => {
  it('says there is no open case, and why once she pauses', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(emptyInbox)
    const { user } = renderWorkspace('/analyst/cases')
    expect(
      await screen.findByRole('heading', { name: 'Você não tem casos abertos' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Você está disponível. Quando um cliente escrever e o caso for seu, ele aparece aqui.',
      ),
    ).toBeInTheDocument()
    expect(document.title).toBe('Casos · LATAM Bank Suporte')

    await user.click(await screen.findByRole('button', { name: 'Disponível. Pausar casos novos' }))
    expect(
      await screen.findByText(
        'Você está em pausa: não recebe casos novos. Fique disponível para receber o próximo.',
      ),
    ).toBeInTheDocument()
  })

  it('asks her to pick a case when the filter shows none', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(makeInbox([], { all: 2 }))
    renderWorkspace('/analyst/cases')
    expect(
      await screen.findByRole('heading', { name: 'Escolha um caso da lista' }),
    ).toBeInTheDocument()
    expect(screen.getByText('A conversa com o cliente aparece aqui.')).toBeInTheDocument()
  })

  it('opens the ficha and closes it (AI off)', async () => {
    const { user, router } = renderWorkspace(
      '/analyst/cases?case=CASE-00000000000000000000000101&panel=customer',
    )
    const panel = await screen.findByRole('complementary', { name: 'Ficha do cliente' })
    await user.click(within(panel).getByRole('button', { name: 'Fechar a ficha do cliente' }))
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('panel')).toBeNull(),
    )
  })

  it('names the support panel and its tabs (AI on)', async () => {
    const { user, router } = renderWorkspace(`/analyst/cases?case=${HANDOFF_CASE}&panel=copilot`, {
      aiEnabled: true,
    })
    const panel = await screen.findByRole('complementary', { name: 'Apoio ao caso' })
    const tabs = within(panel).getByRole('tablist', { name: 'Apoio' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Transferência', 'Copiloto', 'Ferramentas', 'Cliente'])
    await user.click(within(tabs).getByRole('tab', { name: 'Ferramentas' }))
    expect(new URLSearchParams(router.state.location.search).get('panel')).toBe('tools')
    expect(
      within(panel).getByRole('button', { name: 'Fechar o painel de apoio' }),
    ).toBeInTheDocument()
  })
})
