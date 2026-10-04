import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AdminApi from '@/features/admin/api'
import { fetchAdminUsers } from '@/features/admin/api'
import type * as AuditApi from '@/features/audit/api'
import { fetchAuditEvents, fetchStaffDirectory } from '@/features/audit/api'
import { ANDRES_V_ID, makeUserList } from '@/test/admin-fixtures'
import { LUCIA_ID, makeAuditEvent, makeAuditPage } from '@/test/audit-fixtures'
import { TEAM_ANDES, adminStaff, supervisorAdminStaff, supervisorStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'

vi.mock('@/features/audit/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AuditApi>()
  return {
    ...actual,
    fetchAuditEvents: vi.fn<typeof actual.fetchAuditEvents>(),
    fetchAuditEvent: vi.fn<typeof actual.fetchAuditEvent>(),
    fetchStaffDirectory: vi.fn<typeof actual.fetchStaffDirectory>(),
  }
})

vi.mock('@/features/admin/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminApi>()
  return { ...actual, fetchAdminUsers: vi.fn<typeof actual.fetchAdminUsers>() }
})

const deactivated = makeAuditEvent({
  type: 'staff.deactivated',
  family: 'administration',
  description: 'Desactivó la cuenta de Andrés Villamil',
  actor: { role: 'admin', id: supervisorAdminStaff.id, name: supervisorAdminStaff.name },
  entity: 'staff',
  entityId: ANDRES_V_ID,
  caseRef: null,
  payload: { revoked_sessions: 0 },
})
const assigned = makeAuditEvent()

beforeEach(() => {
  vi.mocked(fetchAuditEvents).mockResolvedValue(makeAuditPage([deactivated, assigned]))
  vi.mocked(fetchStaffDirectory).mockResolvedValue([
    { ...supervisorStaff, id: LUCIA_ID, name: 'Lucía Herrera' },
    {
      id: ANDRES_V_ID,
      name: 'Andrés Villamil',
      email: 'andres.villamil@latambank.example',
      roles: ['analyst'],
      languages: ['es'],
      team: TEAM_ANDES,
      active: false,
    },
  ])
  vi.mocked(fetchAdminUsers).mockResolvedValue(makeUserList())
})

describe('audit (administration)', () => {
  it('reuses the audit screen in the admin section, searching an id from the URL', async () => {
    renderRoute(`/administracion/auditoria?q=${ANDRES_V_ID}&tipo=administracion`, {
      staff: adminStaff,
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Auditoría' })).toBeInTheDocument()
    await screen.findByRole('table', { name: 'Eventos' })
    expect(fetchAuditEvents).toHaveBeenCalledWith(
      { family: 'administration', q: ANDRES_V_ID },
      null,
      expect.anything(),
    )
    expect(screen.getByRole('combobox', { name: 'Tipo' })).toHaveValue('administration')
    expect(
      await screen.findByRole('option', { name: 'Andrés Villamil (desactivada)' }),
    ).toBeInTheDocument()
    const rail = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(rail).getByRole('link', { name: 'Auditoría' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(screen.getByRole('table', { name: 'Eventos' })).getByRole('row', {
        name: /Desactivó la cuenta de Andrés Villamil/,
      }),
    ).toBeInTheDocument()
  })

  it('hides "Ver la conversación" from an admin without Supervisión', async () => {
    const { user } = renderRoute(`/administracion/auditoria?evento=${assigned.id}`, {
      staff: adminStaff,
    })
    const detail = await screen.findByRole('complementary', { name: 'Detalle del registro' })
    expect(
      await within(detail).findByRole('button', { name: 'Filtrar por este caso' }),
    ).toBeInTheDocument()
    expect(
      within(detail).queryByRole('link', { name: 'Ver la conversación' }),
    ).not.toBeInTheDocument()
    await user.click(within(detail).getByRole('button', { name: 'Filtrar por este caso' }))
    await waitFor(() =>
      expect(fetchAuditEvents).toHaveBeenLastCalledWith(
        { caseId: assigned.caseRef?.id },
        null,
        expect.anything(),
      ),
    )
  })

  it('keeps "Ver la conversación" for a supervisor-admin', async () => {
    renderRoute(`/administracion/auditoria?evento=${assigned.id}`, { staff: supervisorAdminStaff })
    const detail = await screen.findByRole('complementary', { name: 'Detalle del registro' })
    expect(
      await within(detail).findByRole('link', { name: 'Ver la conversación' }),
    ).toHaveAttribute('href', `/supervision/casos/${assigned.caseRef?.id}`)
  })
})
