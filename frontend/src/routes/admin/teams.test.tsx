import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AdminApi from '@/features/admin/api'
import {
  createTeam,
  deactivateTeam,
  fetchAdminTeam,
  fetchAdminTeams,
  fetchAdminUsers,
  reactivateTeam,
  renameTeam,
  updateUser,
} from '@/features/admin/api'
import { ApiProblem } from '@/lib/api'
import {
  daniela,
  makeAdminTeam,
  makeTeamDetail,
  makeTeamList,
  makeUserList,
  mariana,
  teamAndes,
  teamCaribe,
  teamPacifico,
} from '@/test/admin-fixtures'
import { NOW } from '@/test/case-fixtures'
import { adminStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'

vi.mock('@/features/admin/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminApi>()
  return {
    ...actual,
    fetchAdminUsers: vi.fn<typeof actual.fetchAdminUsers>(),
    fetchAdminTeams: vi.fn<typeof actual.fetchAdminTeams>(),
    fetchAdminTeam: vi.fn<typeof actual.fetchAdminTeam>(),
    createTeam: vi.fn<typeof actual.createTeam>(),
    renameTeam: vi.fn<typeof actual.renameTeam>(),
    deactivateTeam: vi.fn<typeof actual.deactivateTeam>(),
    reactivateTeam: vi.fn<typeof actual.reactivateTeam>(),
    updateUser: vi.fn<typeof actual.updateUser>(),
  }
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchAdminUsers).mockResolvedValue(makeUserList())
  vi.mocked(fetchAdminTeams).mockImplementation((status) =>
    Promise.resolve(
      makeTeamList(
        [teamAndes, teamPacifico, teamCaribe].filter(
          (team) => status === 'all' || team.active === (status === 'active'),
        ),
      ),
    ),
  )
  vi.mocked(fetchAdminTeam).mockImplementation((teamId) =>
    teamId === teamAndes.id
      ? Promise.resolve(makeTeamDetail())
      : teamId === teamCaribe.id
        ? Promise.resolve(makeTeamDetail(teamCaribe, []))
        : Promise.reject(new ApiProblem({ status: 404, code: 'not_found' })),
  )
})

afterEach(() => {
  vi.useRealTimers()
})

function renderTeams(path = '/administracion/equipos') {
  return renderRoute(path, { staff: adminStaff })
}

const table = () => screen.getByRole('table', { name: 'Equipos' })
const aside = () => screen.getByRole('complementary', { name: 'Equipo seleccionado' })

describe('Equipos', () => {
  it('lists the active teams with their people, the Filtros dropdown and the rail', async () => {
    const { user } = renderTeams()
    expect(await screen.findByRole('heading', { level: 1, name: 'Equipos' })).toBeInTheDocument()
    await screen.findByRole('table', { name: 'Equipos' })
    expect(screen.getByText('4 equipos en la plataforma')).toBeInTheDocument()
    expect(screen.getByText('2 de 4 equipos')).toBeInTheDocument()
    // One "Filtros" dropdown with a chip, never a row of pills (slice 9 rule).
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByRole('button', { name: 'Quitar filtro Activos' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Filtros 1 activos' }))
    const panel = screen.getByRole('group', { name: 'Filtros' })
    expect(within(panel).getByRole('checkbox', { name: 'Activos 3' })).toBeChecked()
    expect(within(panel).getByRole('checkbox', { name: 'Inactivos 1' })).not.toBeChecked()
    await user.keyboard('{Escape}')
    const andes = within(table()).getByRole('row', { name: /Equipo Andes/ })
    expect(
      within(andes)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Equipo Andes', '4', '3', 'Activo'])
    // The state is a glyph + word (Status), not a pill.
    const state = within(andes).getByText('Activo').parentElement!
    expect(state.querySelector('svg')).toHaveAttribute('data-status-shape', 'check')
    expect(state).not.toHaveClass('rounded-full')
    expect(within(table()).queryByText('Equipo Caribe')).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', {
        name: 'Equipos',
      }),
    ).toHaveAttribute('aria-current', 'page')
    expect(within(aside()).getByText('Elige un equipo para ver sus personas.')).toBeInTheDocument()
  })

  it('filters by state from Filtros, replacing the history entry, and says when none match', async () => {
    const { user, router } = renderTeams()
    await screen.findByRole('table', { name: 'Equipos' })
    await user.click(screen.getByRole('button', { name: 'Filtros 1 activos' }))
    const panel = screen.getByRole('group', { name: 'Filtros' })
    // Both states checked: every team.
    await user.click(within(panel).getByRole('checkbox', { name: 'Inactivos 1' }))
    expect(router.state.location.search).toBe('?estado=activos%2Cinactivos')
    expect(router.state.historyAction).toBe('REPLACE')
    await waitFor(() => expect(fetchAdminTeams).toHaveBeenLastCalledWith('all', expect.anything()))
    // Only the inactive ones.
    await user.click(within(panel).getByRole('checkbox', { name: 'Activos 3' }))
    expect(router.state.location.search).toBe('?estado=inactivos')
    const caribe = await within(table()).findByRole('row', { name: /Equipo Caribe/ })
    const inactive = within(caribe).getByText('Inactivo').parentElement!
    expect(inactive.querySelector('svg')).toHaveAttribute('data-status-shape', 'cross')
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(router.state.location.search).toBe('?estado=todos')
    expect(await within(table()).findByRole('row', { name: /Equipo Andes/ })).toBeInTheDocument()
    expect(within(table()).getByRole('row', { name: /Equipo Caribe/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Quitar filtro/ })).toBeNull()
  })

  it('says when no team has the checked state', async () => {
    vi.mocked(fetchAdminTeams).mockResolvedValue(makeTeamList([]))
    renderTeams('/administracion/equipos?estado=inactivos')
    expect(await screen.findByText('No hay equipos en este estado.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar filtro Inactivos' })).toBeInTheDocument()
  })

  it('shows the selected team with its members; deactivation is disabled with members', async () => {
    const { user, router } = renderTeams()
    await user.click(await screen.findByRole('button', { name: 'Equipo Andes' }))
    expect(new URLSearchParams(router.state.location.search).get('equipo')).toBe(teamAndes.id)
    const panel = aside()
    expect(await within(panel).findByRole('heading', { name: 'Equipo Andes' })).toBeInTheDocument()
    expect(within(panel).getByText(teamAndes.id)).toBeInTheDocument()
    // The state as glyph + word, the creation date as its own text (never dot-joined).
    expect(within(panel).getByText('Activo').parentElement).toHaveTextContent('Estado: Activo')
    expect(within(panel).getByText('Activo').parentElement!.querySelector('svg')).toHaveAttribute(
      'data-status-shape',
      'check',
    )
    expect(within(panel).getByText('Creado el 3 feb 2026')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: daniela.name })).toHaveAttribute(
      'href',
      `/administracion/usuarios?persona=${daniela.id}`,
    )
    expect(within(panel).getByText('Desactivada')).toBeInTheDocument()
    const deactivate = within(panel).getByRole('button', { name: 'Desactivar equipo' })
    expect(deactivate).toBeDisabled()
    expect(deactivate).toHaveAccessibleDescription(
      'Para desactivarlo, primero mueve a sus 4 personas a otro equipo.',
    )
    expect(within(panel).getByRole('link', { name: 'Ver en auditoría' })).toHaveAttribute(
      'href',
      `/administracion/auditoria?q=${teamAndes.id}`,
    )
  })

  it('renames a team with the version it saw, and shows team_name_taken on the field', async () => {
    vi.mocked(renameTeam)
      .mockRejectedValueOnce(
        new ApiProblem({ status: 409, code: 'team_name_taken', extensions: { field: 'name' } }),
      )
      .mockResolvedValueOnce({
        changed: true,
        team: { ...teamAndes, name: 'Equipo Andes Norte', version: 2 },
      })
    const { user } = renderTeams(`/administracion/equipos?equipo=${teamAndes.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Equipo seleccionado' })
    const name = await within(panel).findByRole('textbox', { name: 'Nombre del equipo' })
    expect(within(panel).getByRole('button', { name: 'Guardar nombre' })).toBeDisabled()
    await user.clear(name)
    await user.type(name, 'Equipo Pacífico')
    await user.click(within(panel).getByRole('button', { name: 'Guardar nombre' }))
    await waitFor(() =>
      expect(name).toHaveAccessibleDescription('Ya existe un equipo con ese nombre.'),
    )
    expect(name).toHaveFocus()

    await user.clear(name)
    await user.type(name, 'Equipo Andes Norte')
    await user.click(within(panel).getByRole('button', { name: 'Guardar nombre' }))
    expect(renameTeam).toHaveBeenLastCalledWith(
      teamAndes.id,
      'Equipo Andes Norte',
      teamAndes.version,
    )
    expect(await screen.findByText('Nombre guardado')).toBeInTheDocument()
  })

  it('adds a person from another team through her PATCH', async () => {
    vi.mocked(updateUser).mockResolvedValue({
      changed: true,
      user: { ...mariana, team: { id: teamAndes.id, name: teamAndes.name }, version: 4 },
      revokedSessions: 0,
    })
    const { user } = renderTeams(`/administracion/equipos?equipo=${teamAndes.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Equipo seleccionado' })
    await user.click(await within(panel).findByRole('button', { name: 'Agregar persona' }))
    const dialog = await screen.findByRole('dialog', { name: 'Agregar a Equipo Andes' })
    const person = await within(dialog).findByRole('combobox', { name: 'Persona' })
    // Daniela is already in Andes: not offered.
    expect(within(dialog).queryByRole('option', { name: /Daniela/ })).not.toBeInTheDocument()
    await user.selectOptions(person, 'Mariana Duque · Equipo Pacífico')
    expect(within(dialog).getByText('Pasa de Equipo Pacífico a Equipo Andes.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Mover a Equipo Andes' }))
    expect(updateUser).toHaveBeenCalledWith(mariana.id, {
      expectedVersion: mariana.version,
      teamId: teamAndes.id,
    })
    expect(await screen.findByText('Mariana Duque pasó a Equipo Andes')).toBeInTheDocument()
  })

  it('deactivates an empty team and reactivates it; team_not_empty is explained', async () => {
    const empty = makeAdminTeam({
      id: 'TEAM-00000000000000000000000005',
      name: 'Equipo Sur',
      memberCount: 0,
      analystCount: 0,
      inactiveMemberCount: 0,
    })
    vi.mocked(fetchAdminTeam).mockResolvedValue(makeTeamDetail(empty, []))
    vi.mocked(deactivateTeam).mockRejectedValueOnce(
      new ApiProblem({ status: 409, code: 'team_not_empty', extensions: { memberCount: 1 } }),
    )
    const { user } = renderTeams(`/administracion/equipos?equipo=${empty.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Equipo seleccionado' })
    expect(await within(panel).findByText('Este equipo no tiene personas.')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Desactivar equipo' }))
    let dialog = await screen.findByRole('dialog', {
      name: '¿Desactivar el equipo Equipo Sur?',
    })
    expect(
      within(dialog).getByText(
        'Ya no se podrá mover a nadie a este equipo. Su historial se conserva.',
      ),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar equipo' }))
    expect(
      await within(dialog).findByText(
        'Para desactivarlo, primero mueve a su persona a otro equipo.',
      ),
    ).toBeInTheDocument()

    const inactive = { ...empty, active: false, version: 2 }
    vi.mocked(deactivateTeam).mockResolvedValueOnce({ changed: true, team: inactive })
    vi.mocked(fetchAdminTeam).mockResolvedValue(makeTeamDetail(inactive, []))
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar equipo' }))
    expect(await screen.findByText('Equipo desactivado')).toBeInTheDocument()
    expect(deactivateTeam).toHaveBeenLastCalledWith(empty.id, empty.version)

    vi.mocked(reactivateTeam).mockResolvedValue({
      changed: true,
      team: { ...empty, active: true, version: 3 },
    })
    dialog = aside()
    await user.click(await within(dialog).findByRole('button', { name: 'Reactivar equipo' }))
    expect(reactivateTeam).toHaveBeenCalledWith(empty.id, 2)
    expect(await screen.findByText('Equipo reactivado')).toBeInTheDocument()
  })

  it('creates a team with an idempotency key and selects it', async () => {
    const sur = makeAdminTeam({
      id: 'TEAM-00000000000000000000000005',
      name: 'Equipo Sur',
      memberCount: 0,
      analystCount: 0,
    })
    vi.mocked(createTeam).mockResolvedValue(sur)
    vi.mocked(fetchAdminTeam).mockResolvedValue(makeTeamDetail(sur, []))
    const { user, router } = renderTeams()
    await screen.findByRole('table', { name: 'Equipos' })
    await user.click(screen.getByRole('button', { name: 'Nuevo equipo' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo equipo' })
    await user.click(within(dialog).getByRole('button', { name: 'Crear equipo' }))
    expect(within(dialog).getByRole('textbox', { name: 'Nombre' })).toHaveAccessibleDescription(
      'Escribe un nombre de al menos 2 caracteres.',
    )
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Equipo Sur')
    await user.click(within(dialog).getByRole('button', { name: 'Crear equipo' }))
    expect(createTeam).toHaveBeenCalledWith('Equipo Sur', expect.any(String))
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('equipo')).toBe(sur.id),
    )
    expect(new URLSearchParams(router.state.location.search).get('nuevo')).toBeNull()
  })

  it('says when the linked team does not exist', async () => {
    renderTeams('/administracion/equipos?equipo=TEAM-NADA')
    expect(await screen.findByText('No encontramos ese equipo.')).toBeInTheDocument()
  })
})
