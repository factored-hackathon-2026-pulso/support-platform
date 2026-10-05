/**
 * Deep links on a first visit in Portuguese (slice 23b): only `common` and `shell` are loaded
 * when the screen mounts, as in a fresh tab. Every screen must wait for the namespaces whose
 * words it shows, its own and the shared ones (the case vocabulary of `cases`, the language
 * names of `conversation`), so no catalog key is ever printed instead of its text.
 */
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AdminApi from '@/features/admin/api'
import { fetchAdminTeam, fetchAdminTeams, fetchAdminUsers } from '@/features/admin/api'
import type * as AuditApi from '@/features/audit/api'
import { fetchAuditEvents, fetchStaffDirectory } from '@/features/audit/api'
import type * as CasesApi from '@/features/cases/api'
import { fetchAvailability, fetchInbox } from '@/features/cases/api'
import type * as ConversationApi from '@/features/conversation/api'
import {
  fetchCaseDetail,
  fetchCaseHistory,
  fetchTurns,
  markCaseRead,
} from '@/features/conversation/api'
import type * as HomeApi from '@/features/home/api'
import { fetchHome } from '@/features/home/api'
import type * as NotificationsApi from '@/features/notifications/api'
import { fetchNotifications } from '@/features/notifications/api'
import type * as SupervisionApi from '@/features/supervision/api'
import {
  fetchEscalations,
  fetchOpenCases,
  fetchQueueOverview,
  fetchTeamOverview,
} from '@/features/supervision/api'
import { loadAllCatalogs } from '@/lib/i18n'
import {
  makeTeamDetail,
  makeTeamList,
  makeUserList,
  teamAndes,
  teamPacifico,
} from '@/test/admin-fixtures'
import { makeAuditEvent, makeAuditPage } from '@/test/audit-fixtures'
import { NOW, available, makeInbox } from '@/test/case-fixtures'
import { rawCatalogKeys, unloadLazyCatalogs } from '@/test/cold-catalogs'
import { CASE_ID, makeCaseDetail, patriciaHistory, seededTurns } from '@/test/conversation-fixtures'
import { adminStaff, analystStaff, supervisorStaff } from '@/test/fixtures'
import { makeHome } from '@/test/home-fixtures'
import { analystNotifications, makeNotificationPage } from '@/test/notification-fixtures'
import { renderRoute } from '@/test/render'
import {
  makeEscalationOverview,
  makeOpenCases,
  makeQueueOverview,
  makeTeamOverview,
  portugueseOpenCases,
} from '@/test/supervision-fixtures'

vi.mock('@/features/cases/api', async (importOriginal) => {
  const actual = await importOriginal<typeof CasesApi>()
  return {
    ...actual,
    fetchInbox: vi.fn<typeof actual.fetchInbox>(),
    fetchAvailability: vi.fn<typeof actual.fetchAvailability>(),
  }
})

vi.mock('@/features/home/api', async (importOriginal) => {
  const actual = await importOriginal<typeof HomeApi>()
  return { ...actual, fetchHome: vi.fn<typeof actual.fetchHome>() }
})

vi.mock('@/features/notifications/api', async (importOriginal) => {
  const actual = await importOriginal<typeof NotificationsApi>()
  return { ...actual, fetchNotifications: vi.fn<typeof actual.fetchNotifications>() }
})

vi.mock('@/features/conversation/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ConversationApi>()
  return {
    ...actual,
    fetchCaseDetail: vi.fn<typeof actual.fetchCaseDetail>(),
    fetchTurns: vi.fn<typeof actual.fetchTurns>(),
    fetchCaseHistory: vi.fn<typeof actual.fetchCaseHistory>(),
    markCaseRead: vi.fn<typeof actual.markCaseRead>(),
  }
})

vi.mock('@/features/supervision/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisionApi>()
  return {
    ...actual,
    fetchTeamOverview: vi.fn<typeof actual.fetchTeamOverview>(),
    fetchQueueOverview: vi.fn<typeof actual.fetchQueueOverview>(),
    fetchEscalations: vi.fn<typeof actual.fetchEscalations>(),
    fetchOpenCases: vi.fn<typeof actual.fetchOpenCases>(),
  }
})

vi.mock('@/features/admin/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminApi>()
  return {
    ...actual,
    fetchAdminUsers: vi.fn<typeof actual.fetchAdminUsers>(),
    fetchAdminTeams: vi.fn<typeof actual.fetchAdminTeams>(),
    fetchAdminTeam: vi.fn<typeof actual.fetchAdminTeam>(),
  }
})

vi.mock('@/features/audit/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AuditApi>()
  return {
    ...actual,
    fetchAuditEvents: vi.fn<typeof actual.fetchAuditEvents>(),
    fetchStaffDirectory: vi.fn<typeof actual.fetchStaffDirectory>(),
  }
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchInbox).mockResolvedValue(makeInbox())
  vi.mocked(fetchAvailability).mockResolvedValue(available)
  vi.mocked(fetchHome).mockResolvedValue(makeHome())
  vi.mocked(fetchNotifications).mockResolvedValue(makeNotificationPage(analystNotifications))
  vi.mocked(fetchCaseDetail).mockResolvedValue(makeCaseDetail())
  vi.mocked(fetchTurns).mockResolvedValue({
    items: seededTurns(),
    olderCursor: null,
    lastSequence: 4,
  })
  vi.mocked(fetchCaseHistory).mockResolvedValue(patriciaHistory)
  vi.mocked(markCaseRead).mockResolvedValue(makeCaseDetail().case)
  vi.mocked(fetchTeamOverview).mockResolvedValue(makeTeamOverview())
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
  vi.mocked(fetchEscalations).mockResolvedValue(makeEscalationOverview())
  vi.mocked(fetchOpenCases).mockImplementation((language) =>
    Promise.resolve(language === 'pt' ? portugueseOpenCases : makeOpenCases()),
  )
  vi.mocked(fetchAuditEvents).mockResolvedValue(makeAuditPage([makeAuditEvent()]))
  vi.mocked(fetchStaffDirectory).mockResolvedValue([])
  vi.mocked(fetchAdminUsers).mockResolvedValue(makeUserList())
  vi.mocked(fetchAdminTeams).mockResolvedValue(makeTeamList([teamAndes, teamPacifico]))
  vi.mocked(fetchAdminTeam).mockResolvedValue(makeTeamDetail())
  unloadLazyCatalogs()
})

afterEach(async () => {
  vi.useRealTimers()
  await loadAllCatalogs()
})

/** The screen settled with every word in Portuguese: no key printed in its place. */
async function expectNoRawKeys(): Promise<void> {
  await waitFor(() => expect(rawCatalogKeys()).toEqual([]))
}

describe('a deep link on a cold load, in Portuguese (slice 23b)', () => {
  it('opens Inicio with the case words of its first cases', async () => {
    renderRoute('/analyst/home', { staff: analystStaff, locale: 'pt-BR' })
    expect(await screen.findByRole('heading', { level: 1, name: /^Bom dia/ })).toBeInTheDocument()
    expect(await screen.findAllByText('Beatriz Salcedo Prieto')).not.toHaveLength(0)
    await expectNoRawKeys()
  })

  it('opens a case in Casos with its header, its file and the case list', async () => {
    renderRoute(`/analyst/cases?case=${CASE_ID}`, { staff: analystStaff, locale: 'pt-BR' })
    expect(await screen.findAllByText('Marcela Quintana Pardo')).not.toHaveLength(0)
    expect(await screen.findAllByText('Beatriz Salcedo Prieto')).not.toHaveLength(0)
    await expectNoRawKeys()
  })

  it('opens a case under supervision with its language and status', async () => {
    renderRoute(`/supervision/cases/${CASE_ID}`, { staff: supervisorStaff, locale: 'pt-BR' })
    expect(
      await screen.findByRole('heading', { level: 1, name: /^Conversa de .+ \(supervisão\)$/ }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Somente leitura')).toBeInTheDocument()
    await expectNoRawKeys()
  })

  it('opens Filas with the queue of each language', async () => {
    renderRoute('/supervision/queues', { staff: supervisorStaff, locale: 'pt-BR' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Filas' })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: /^Casos abertos em / })).toBeInTheDocument()
    await expectNoRawKeys()
  })

  it('opens Equipe', async () => {
    renderRoute('/supervision/team', { staff: supervisorStaff, locale: 'pt-BR' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Equipe' })).toBeInTheDocument()
    await screen.findAllByText(/Daniela Ríos/)
    await expectNoRawKeys()
  })

  it('opens Escalados', async () => {
    renderRoute('/supervision/escalations', { staff: supervisorStaff, locale: 'pt-BR' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Escalados' })).toBeInTheDocument()
    await screen.findAllByText(/Camila/)
    await expectNoRawKeys()
  })

  it('opens Auditoria', async () => {
    renderRoute('/supervision/audit', { staff: supervisorStaff, locale: 'pt-BR' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Auditoria' })).toBeInTheDocument()
    await expectNoRawKeys()
  })

  it('opens Usuários e perfis', async () => {
    renderRoute('/admin/users', { staff: adminStaff, locale: 'pt-BR' })
    expect(await screen.findByRole('heading', { level: 1, name: /^Usuários/ })).toBeInTheDocument()
    await screen.findAllByText(/Daniela/)
    await expectNoRawKeys()
  })

  it('opens a team in Equipes', async () => {
    renderRoute(`/admin/teams?team=${teamAndes.id}`, { staff: adminStaff, locale: 'pt-BR' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Equipes' })).toBeInTheDocument()
    await screen.findAllByText(teamAndes.name)
    await expectNoRawKeys()
  })
})
