import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AdminApi from '@/features/admin/api'
import {
  createUser,
  deactivateUser,
  fetchAdminTeams,
  fetchAdminUser,
  fetchAdminUsers,
  reactivateUser,
  resetPassword,
  unlockUser,
  updateUser,
} from '@/features/admin/api'
import { ApiProblem } from '@/lib/api'
import {
  andres,
  carolina,
  daniela,
  makeTeamList,
  makeUserList,
  mariana,
  selfAdmin,
} from '@/test/admin-fixtures'
import { NOW } from '@/test/case-fixtures'
import { TEAM_PACIFICO, adminStaff, supervisorAdminStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'

vi.mock('@/features/admin/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminApi>()
  return {
    ...actual,
    fetchAdminUsers: vi.fn<typeof actual.fetchAdminUsers>(),
    fetchAdminUser: vi.fn<typeof actual.fetchAdminUser>(),
    fetchAdminTeams: vi.fn<typeof actual.fetchAdminTeams>(),
    createUser: vi.fn<typeof actual.createUser>(),
    updateUser: vi.fn<typeof actual.updateUser>(),
    deactivateUser: vi.fn<typeof actual.deactivateUser>(),
    reactivateUser: vi.fn<typeof actual.reactivateUser>(),
    unlockUser: vi.fn<typeof actual.unlockUser>(),
    resetPassword: vi.fn<typeof actual.resetPassword>(),
  }
})

beforeEach(() => {
  // Only Date is faked: lock expiries read the pinned clock, timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchAdminUsers).mockResolvedValue(makeUserList())
  vi.mocked(fetchAdminTeams).mockResolvedValue(makeTeamList())
  vi.mocked(fetchAdminUser).mockRejectedValue(new ApiProblem({ status: 404, code: 'not_found' }))
})

afterEach(() => {
  vi.useRealTimers()
})

function renderUsers(path = '/administracion/usuarios', staff = adminStaff) {
  return renderRoute(path, { staff })
}

const table = () => screen.getByRole('table', { name: 'Personas' })
const row = (name: RegExp) => within(table()).getByRole('row', { name })
const aside = () => screen.getByRole('complementary', { name: 'Persona seleccionada' })
const search = (router: { state: { location: { search: string } } }) =>
  new URLSearchParams(router.state.location.search)

describe('Usuarios y roles', () => {
  it('lists people with their roles, languages, team and account, the filters and the badge', async () => {
    renderUsers()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Usuarios y roles' }),
    ).toBeInTheDocument()
    expect(document.title).toBe('Usuarios y roles · LATAM Bank Soporte')
    await screen.findByRole('table', { name: 'Personas' })
    expect(screen.getByText('13 personas en la plataforma')).toBeInTheDocument()
    expect(screen.getByText('4 personas')).toBeInTheDocument()
    // One "Filtros" dropdown, never pill rows or selects (slice 9).
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()

    const danielaRow = row(/Daniela Ríos Medina/)
    expect(within(danielaRow).getByText('daniela.rios@latambank.example')).toBeInTheDocument()
    expect(within(danielaRow).getByText('Analista')).toBeInTheDocument()
    expect(within(danielaRow).getByText('español, portugués')).toBeInTheDocument()
    expect(within(danielaRow).getByText('Equipo Andes')).toBeInTheDocument()
    expect(within(danielaRow).getByText('Activa')).toBeInTheDocument()
    const carolinaRow = row(/Carolina Peña Ruiz/)
    expect(within(carolinaRow).getByText('Supervisión')).toBeInTheDocument()
    expect(within(carolinaRow).getByText('Administración')).toBeInTheDocument()
    expect(within(carolinaRow).getByText('—')).toBeInTheDocument()
    // Account status as glyph + word: a lock, its end time on hover.
    const locked = within(row(/Mariana Duque/)).getByText('Bloqueada').parentElement!
    expect(locked).toHaveAttribute('title', 'Hasta las 11:13')
    expect(locked.querySelector('svg')).toHaveAttribute('data-status-shape', 'lock')
    expect(
      within(danielaRow).getByText('Activa').parentElement!.querySelector('svg'),
    ).toHaveAttribute('data-status-shape', 'check')

    expect(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', {
        name: 'Usuarios y roles, 1 pendiente',
      }),
    ).toBeInTheDocument()
    expect(
      within(aside()).getByText('Elige una persona para ver y editar su cuenta.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Personas, roles, idiomas y equipos: directorio de la plataforma (datos de ejemplo).',
      ),
    ).toBeInTheDocument()
    // Everyone once (the search only); the groups filter on the screen.
    expect(fetchAdminUsers).toHaveBeenCalledWith({ status: 'all' }, expect.anything())
  })

  it('filters with the Filtros dropdown (faceted counts, chips) and the search, replacing the history entry', async () => {
    const { user, router } = renderUsers()
    await screen.findByRole('table', { name: 'Personas' })
    await user.click(screen.getByRole('button', { name: 'Filtros' }))
    const panel = screen.getByRole('group', { name: 'Filtros' })
    expect(within(panel).getByRole('group', { name: 'Rol' })).toBeInTheDocument()
    expect(within(panel).getByRole('checkbox', { name: 'Analista 1' })).toBeInTheDocument()
    expect(within(panel).getByRole('checkbox', { name: 'Administración 2' })).toBeInTheDocument()
    expect(
      await within(panel).findByRole('checkbox', { name: 'Equipo Caribe (inactivo) 0' }),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('checkbox', { name: 'Portugués 1' })).toBeInTheDocument()

    await user.click(within(panel).getByRole('checkbox', { name: 'Supervisión 2' }))
    expect(router.state.location.search).toBe('?rol=supervision')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(within(table()).queryByRole('row', { name: /Daniela Ríos Medina/ })).toBeNull()
    expect(row(/Carolina Peña Ruiz/)).toBeInTheDocument()
    expect(screen.getByText('2 de 4 personas')).toBeInTheDocument()
    // The other groups count only supervisors now.
    expect(within(panel).getByRole('checkbox', { name: 'Activa 1' })).toBeInTheDocument()
    await user.click(within(panel).getByRole('checkbox', { name: 'Bloqueada 1' }))
    expect(search(router).get('estado')).toBe('bloqueadas')
    expect(within(table()).getAllByRole('row')).toHaveLength(2) // header + Mariana
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Filtros 2 activos' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Quitar filtro Supervisión' }))
    expect(router.state.location.search).toBe('?estado=bloqueadas')
    await user.type(screen.getByRole('searchbox', { name: 'Buscar persona' }), 'Duque')
    await waitFor(() => expect(search(router).get('q')).toBe('Duque'))
    await waitFor(() =>
      expect(fetchAdminUsers).toHaveBeenLastCalledWith(
        { status: 'all', q: 'Duque' },
        expect.anything(),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(router.state.location.search).toBe('?q=Duque')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('offers "Limpiar filtros" when nobody matches, and retries after an error', async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue(makeUserList([]))
    const { user, router } = renderUsers('/administracion/usuarios?estado=bloqueadas&idioma=pt')
    expect(
      await screen.findByRole('heading', { name: 'Nadie coincide con estos filtros.' }),
    ).toBeInTheDocument()
    const clear = screen.getAllByRole('button', { name: 'Limpiar filtros' })
    await user.click(clear[clear.length - 1]!)
    expect(router.state.location.search).toBe('')
  })

  it('shows an error with a retry', async () => {
    vi.mocked(fetchAdminUsers).mockRejectedValue(ApiProblem.network())
    const { user } = renderUsers()
    expect(await screen.findByText('No pudimos cargar las personas')).toBeInTheDocument()
    vi.mocked(fetchAdminUsers).mockResolvedValue(makeUserList())
    await user.click(screen.getAllByRole('button', { name: 'Reintentar' })[0]!)
    expect(await screen.findByRole('table', { name: 'Personas' })).toBeInTheDocument()
  })

  it('shows a locked person with "Desbloquear", and unlocks her', async () => {
    vi.mocked(unlockUser).mockResolvedValue({
      changed: true,
      user: { ...mariana, status: 'active', lockedUntil: null, failedAttempts: 0, version: 4 },
      revokedSessions: 0,
    })
    const { user, router } = renderUsers()
    await user.click(await screen.findByRole('button', { name: 'Mariana Duque' }))
    expect(search(router).get('persona')).toBe(mariana.id)
    expect(router.state.historyAction).toBe('PUSH')
    const panel = aside()
    expect(within(panel).getByRole('heading', { name: 'Mariana Duque' })).toBeInTheDocument()
    // Structured items, not a dot-joined line (slice 6): a role chip, languages, team.
    expect(
      within(panel).getByText('Supervisión', { selector: 'span.rounded-full' }),
    ).toBeInTheDocument()
    expect(within(panel).getByText('Idiomas:').parentElement).toHaveTextContent('Español')
    expect(within(panel).getByText('Equipo:').parentElement).toHaveTextContent('Equipo Pacífico')
    expect(
      within(panel).getByText('5 intentos fallidos. Se desbloquea sola a las 11:13.'),
    ).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Desbloquear' }))
    expect(unlockUser).toHaveBeenCalledWith(mariana.id)
    expect(await screen.findByText('Cuenta desbloqueada')).toBeInTheDocument()
    expect(
      screen.getByText('Mariana Duque ya puede volver a intentar ingresar.'),
    ).toBeInTheDocument()
    expect(within(aside()).queryByText(/Se desbloquea sola/)).not.toBeInTheDocument()
  })

  it('fetches an inactive person outside the list and reactivates her', async () => {
    vi.mocked(fetchAdminUser).mockResolvedValue(andres)
    vi.mocked(reactivateUser).mockResolvedValue({
      changed: true,
      user: { ...andres, status: 'active', version: 4 },
      revokedSessions: 0,
    })
    const { user } = renderUsers(`/administracion/usuarios?persona=${andres.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    expect(await within(panel).findByText('No puede ingresar.')).toBeInTheDocument()
    expect(fetchAdminUser).toHaveBeenCalledWith(andres.id, expect.anything())
    expect(within(panel).getByText('Nunca')).toBeInTheDocument()
    expect(
      within(panel).queryByRole('button', { name: 'Desactivar cuenta' }),
    ).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Reactivar cuenta' }))
    expect(reactivateUser).toHaveBeenCalledWith(andres.id, andres.version)
    expect(await screen.findByText('Cuenta reactivada')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Andrés Villamil puede volver a ingresar con su contraseña. Empieza En pausa.',
      ),
    ).toBeInTheDocument()
  })

  it('says when the linked person does not exist', async () => {
    renderUsers('/administracion/usuarios?persona=STF-NADIE')
    expect(await screen.findByText('No encontramos a esa persona.')).toBeInTheDocument()
  })

  it('protects the admin herself: her own Administración, deactivation and password', async () => {
    renderUsers(`/administracion/usuarios?persona=${selfAdmin.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    const adminCard = await within(panel).findByRole('checkbox', { name: /^Administración/ })
    expect(adminCard).toBeChecked()
    expect(adminCard).toBeDisabled()
    expect(adminCard).toHaveAccessibleDescription(
      'No puedes quitarte tu propio rol de Administración.',
    )
    expect(within(panel).getByRole('button', { name: 'Desactivar cuenta' })).toBeDisabled()
    expect(
      within(panel).getByRole('button', { name: 'Desactivar cuenta' }),
    ).toHaveAccessibleDescription('No puedes desactivar tu propia cuenta.')
    expect(within(panel).getByRole('button', { name: 'Restablecer contraseña' })).toBeDisabled()
    expect(
      within(panel).getByText(
        'Pídele a otra persona de Administración que restablezca tu contraseña.',
      ),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Ver en auditoría' })).toHaveAttribute(
      'href',
      `/administracion/auditoria?q=${selfAdmin.id}`,
    )
  })

  it('blocks removing a language or Analista while she holds open cases (no request)', async () => {
    const { user } = renderUsers(`/administracion/usuarios?persona=${daniela.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await within(panel).findByRole('heading', { name: daniela.name })
    expect(within(panel).getByText('5 · 4 en español · 1 en portugués')).toBeInTheDocument()
    expect(within(panel).getByText('Disponible')).toBeInTheDocument()
    const save = within(panel).getByRole('button', { name: 'Guardar cambios' })
    expect(save).toBeDisabled()

    await user.click(within(panel).getByRole('checkbox', { name: 'Portugués' }))
    expect(save).toBeEnabled()
    await user.click(save)
    const portuguese = within(panel).getByRole('checkbox', { name: 'Portugués' })
    // It asks again first (the count may be stale); the server still says 1.
    await waitFor(() =>
      expect(portuguese).toHaveAccessibleDescription(
        expect.stringContaining(
          'Tiene 1 caso abierto en portugués: supervisión tiene que reasignarlos antes de quitarle ese idioma.',
        ),
      ),
    )
    expect(within(panel).getByRole('checkbox', { name: 'Español' })).toHaveFocus()

    await user.click(within(panel).getByRole('checkbox', { name: 'Portugués' }))
    await user.click(within(panel).getByRole('checkbox', { name: /^Analista/ }))
    await user.click(within(panel).getByRole('checkbox', { name: /^Supervisión/ }))
    await user.click(within(panel).getByRole('button', { name: 'Guardar cambios' }))
    expect(
      await within(panel).findByText(
        'Tiene 5 casos abiertos: supervisión tiene que reasignarlos antes de quitarle el rol de Analista.',
      ),
    ).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('saves a change a stale open-case count would block once supervision cleared it', async () => {
    vi.mocked(updateUser).mockResolvedValue({
      changed: true,
      user: { ...daniela, languages: ['es'], openCases: { total: 4, es: 4, pt: 0 }, version: 6 },
      revokedSessions: 0,
    })
    const { user } = renderUsers(`/administracion/usuarios?persona=${daniela.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await within(panel).findByRole('heading', { name: daniela.name })
    // Supervision moved her Portuguese case away; this screen did not hear about it.
    vi.mocked(fetchAdminUser).mockResolvedValue({
      ...daniela,
      openCases: { total: 4, es: 4, pt: 0 },
    })
    await user.click(within(panel).getByRole('checkbox', { name: 'Portugués' }))
    await user.click(within(panel).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(daniela.id, {
        expectedVersion: daniela.version,
        languages: ['es'],
      }),
    )
    expect(fetchAdminUser).toHaveBeenCalledWith(daniela.id, expect.anything())
  })

  it('saves only the changes with the version she saw', async () => {
    vi.mocked(updateUser).mockResolvedValue({
      changed: true,
      user: { ...daniela, roles: ['analyst', 'supervisor'], version: 8 },
      revokedSessions: 0,
    })
    const { user } = renderUsers(`/administracion/usuarios?persona=${daniela.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await user.click(await within(panel).findByRole('checkbox', { name: /^Supervisión/ }))
    expect(
      within(panel).getByText(/Los cambios de rol se aplican de inmediato/),
    ).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Guardar cambios' }))
    expect(updateUser).toHaveBeenCalledWith(daniela.id, {
      expectedVersion: daniela.version,
      roles: ['analyst', 'supervisor'],
    })
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument()
    expect(within(aside()).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  it('on version_conflict loads the current data into the form and says so', async () => {
    const current = { ...daniela, name: 'Daniela Ríos Mejía', version: 9 }
    vi.mocked(updateUser).mockRejectedValue(
      new ApiProblem({
        status: 409,
        code: 'version_conflict',
        extensions: { currentVersion: 9, current },
      }),
    )
    const { user } = renderUsers(`/administracion/usuarios?persona=${daniela.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    const name = await within(panel).findByRole('textbox', { name: 'Nombre completo' })
    await user.clear(name)
    await user.type(name, 'Daniela Ríos')
    await user.click(within(panel).getByRole('button', { name: 'Guardar cambios' }))
    expect(
      await within(panel).findByText(
        'Alguien más cambió a esta persona mientras editabas. Cargamos los datos actuales: revisa y vuelve a guardar.',
      ),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('textbox', { name: 'Nombre completo' })).toHaveValue(
      'Daniela Ríos Mejía',
    )
    expect(within(panel).getByRole('heading', { name: 'Daniela Ríos Mejía' })).toBeInTheDocument()
  })

  it('warns when someone else changes the person while she has a draft', async () => {
    const { user, queryClient } = renderUsers(`/administracion/usuarios?persona=${daniela.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await user.click(await within(panel).findByRole('checkbox', { name: /^Supervisión/ }))
    const { adminKeys } = await import('@/features/admin')
    queryClient.setQueryData(adminKeys.user(daniela.id), { ...daniela, version: 8 })
    expect(
      await within(panel).findByText(
        'Alguien más acaba de cambiar a esta persona. Si guardas, revisaremos que no choquen tus cambios.',
      ),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('checkbox', { name: /^Supervisión/ })).toBeChecked()
  })

  it('creates a person and shows the temporary password once', async () => {
    const ana = {
      ...daniela,
      id: 'STF-NEW0000001',
      name: 'Ana Gil',
      email: 'ana.gil@latambank.example',
      languages: ['pt' as const],
      team: TEAM_PACIFICO,
      version: 1,
      openCases: { total: 0, es: 0, pt: 0 },
    }
    vi.mocked(createUser).mockResolvedValue({ user: ana, temporaryPassword: 'abcd-efgh-jkmn' })
    vi.mocked(fetchAdminUser).mockResolvedValue(ana)
    const { user, router } = renderUsers()
    await screen.findByRole('table', { name: 'Personas' })
    await user.click(screen.getByRole('button', { name: 'Nuevo usuario' }))
    expect(search(router).get('nueva')).toBe('1')
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' })

    // Empty form: client validation, first invalid control focused, no request.
    await user.click(within(dialog).getByRole('button', { name: 'Crear cuenta' }))
    expect(within(dialog).getByRole('textbox', { name: 'Nombre completo' })).toHaveFocus()
    expect(within(dialog).getByText('Elige al menos un rol.')).toBeInTheDocument()
    expect(createUser).not.toHaveBeenCalled()

    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre completo' }), 'Ana Gil')
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Correo' }),
      'ana.gil@latambank.example',
    )
    await user.click(within(dialog).getByRole('checkbox', { name: /^Analista/ }))
    // Languages are pill toggles (a native checkbox inside each pill, keyboard included).
    const spanish = within(dialog).getByRole('checkbox', { name: 'Español' })
    spanish.focus()
    await user.keyboard(' ')
    expect(spanish).toBeChecked()
    expect(spanish.closest('label')?.querySelector('svg')).not.toBeNull()
    await user.click(spanish)
    expect(spanish).not.toBeChecked()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Portugués' }))
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Equipo' }),
      TEAM_PACIFICO.id,
    )
    expect(within(dialog).queryByRole('option', { name: /Equipo Caribe/ })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Crear cuenta' }))

    expect(createUser).toHaveBeenCalledWith(
      {
        name: 'Ana Gil',
        email: 'ana.gil@latambank.example',
        roles: ['analyst'],
        languages: ['pt'],
        teamId: TEAM_PACIFICO.id,
      },
      expect.stringMatching(/^[A-Za-z0-9-]{8,64}$/),
    )
    const shown = await screen.findByRole('dialog', { name: 'Cuenta creada' })
    expect(
      within(shown).getByText(
        'Ana Gil ya puede ingresar con su correo y esta contraseña temporal. Cópiala ahora: no la volveremos a mostrar.',
      ),
    ).toBeInTheDocument()
    expect(within(shown).getByText('abcd-efgh-jkmn')).toBeInTheDocument()
    expect(
      within(shown).getByText('En desarrollo, el código de verificación es 000000.'),
    ).toBeInTheDocument()
    await user.click(within(shown).getByRole('button', { name: 'Copiar' }))
    expect(await within(shown).findByRole('button', { name: 'Copiada' })).toBeInTheDocument()
    await expect(navigator.clipboard.readText()).resolves.toBe('abcd-efgh-jkmn')
    expect(search(router).get('persona')).toBe(ana.id)
    expect(search(router).get('nueva')).toBeNull()
    // Never in the URL.
    expect(router.state.location.search).not.toContain('abcd')

    await user.click(within(shown).getByRole('button', { name: 'Listo' }))
    expect(screen.queryByText('abcd-efgh-jkmn')).not.toBeInTheDocument()
  })

  it('says the password was already shown on an idempotent replay', async () => {
    vi.mocked(createUser).mockResolvedValue({ user: daniela, temporaryPassword: null })
    vi.mocked(fetchAdminUser).mockResolvedValue(daniela)
    const { user } = renderUsers('/administracion/usuarios?nueva=1')
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre completo' }), daniela.name)
    await user.type(within(dialog).getByRole('textbox', { name: 'Correo' }), daniela.email)
    await user.click(within(dialog).getByRole('checkbox', { name: /^Analista/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Español' }))
    await waitFor(() => expect(within(dialog).getAllByRole('option').length).toBeGreaterThan(1))
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Equipo' }),
      daniela.team.id,
    )
    await user.click(within(dialog).getByRole('button', { name: 'Crear cuenta' }))
    const shown = await screen.findByRole('dialog', { name: 'Cuenta creada' })
    expect(
      within(shown).getByText(
        'La contraseña temporal se mostró al crear la cuenta. Si no la tienes, restablécela.',
      ),
    ).toBeInTheDocument()
    expect(
      within(shown).getByRole('button', { name: 'Restablecer contraseña' }),
    ).toBeInTheDocument()
  })

  it('shows email_taken on the Correo field', async () => {
    vi.mocked(createUser).mockRejectedValue(
      new ApiProblem({ status: 409, code: 'email_taken', extensions: { field: 'email' } }),
    )
    const { user } = renderUsers('/administracion/usuarios?nueva=1')
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre completo' }), 'Ana Gil')
    await user.type(within(dialog).getByRole('textbox', { name: 'Correo' }), daniela.email)
    await user.click(within(dialog).getByRole('checkbox', { name: /^Supervisión/ }))
    await waitFor(() => expect(within(dialog).getAllByRole('option').length).toBeGreaterThan(1))
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Equipo' }),
      TEAM_PACIFICO.id,
    )
    await user.click(within(dialog).getByRole('button', { name: 'Crear cuenta' }))
    const email = within(dialog).getByRole('textbox', { name: 'Correo' })
    await waitFor(() => expect(email).toHaveFocus())
    expect(email).toHaveAccessibleDescription('Ya existe una cuenta con ese correo.')
  })

  it('resets a password and shows the new one', async () => {
    vi.mocked(resetPassword).mockResolvedValue({
      user: { ...mariana, status: 'active', lockedUntil: null, version: 4 },
      temporaryPassword: 'pqrs-tuvw-xyz2',
      revokedSessions: 1,
    })
    const { user } = renderUsers(`/administracion/usuarios?persona=${mariana.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await user.click(await within(panel).findByRole('button', { name: 'Restablecer contraseña' }))
    const confirm = await screen.findByRole('dialog', {
      name: '¿Restablecer la contraseña de Mariana Duque?',
    })
    expect(
      within(confirm).getByText(
        'Se genera una contraseña temporal nueva, se cierran sus sesiones abiertas y se desbloquea la cuenta si estaba bloqueada.',
      ),
    ).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Restablecer' }))
    const shown = await screen.findByRole('dialog', { name: 'Contraseña restablecida' })
    expect(within(shown).getByText('pqrs-tuvw-xyz2')).toBeInTheDocument()
  })

  it('blocks deactivating someone with open cases; only a supervisor-admin gets the link', async () => {
    const { user, unmount } = renderUsers(`/administracion/usuarios?persona=${daniela.id}`)
    let panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await user.click(await within(panel).findByRole('button', { name: 'Desactivar cuenta' }))
    let dialog = await screen.findByRole('dialog', {
      name: `¿Desactivar la cuenta de ${daniela.name}?`,
    })
    expect(within(dialog).getByText('Deja de recibir casos y queda En pausa.')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Tiene 5 casos abiertos. Supervisión los reasigna desde Equipo.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Desactivar cuenta' })).toBeDisabled()
    expect(within(dialog).queryByRole('link', { name: 'Ver en Equipo' })).not.toBeInTheDocument()
    unmount()

    vi.mocked(fetchAdminUsers).mockResolvedValue(
      makeUserList([{ ...carolina, guards: { isSelf: true, lastActiveAdmin: false } }, daniela]),
    )
    const second = renderUsers(
      `/administracion/usuarios?persona=${daniela.id}`,
      supervisorAdminStaff,
    )
    panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await second.user.click(await within(panel).findByRole('button', { name: 'Desactivar cuenta' }))
    dialog = await screen.findByRole('dialog', {
      name: `¿Desactivar la cuenta de ${daniela.name}?`,
    })
    expect(within(dialog).getByRole('link', { name: 'Ver en Equipo' })).toHaveAttribute(
      'href',
      `/supervision/equipo?analista=${daniela.id}`,
    )
  })

  it('re-reads her open cases on open: a block supervision already cleared is gone', async () => {
    vi.mocked(deactivateUser).mockResolvedValue({
      changed: true,
      user: { ...daniela, status: 'inactive', openCases: { total: 0, es: 0, pt: 0 } },
      revokedSessions: 1,
    })
    const { user } = renderUsers(`/administracion/usuarios?persona=${daniela.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    expect(fetchAdminUser).not.toHaveBeenCalled() // the cached record still says 5
    // Supervision reassigned her 5 cases; no signal reached this screen.
    vi.mocked(fetchAdminUser).mockResolvedValue({
      ...daniela,
      openCases: { total: 0, es: 0, pt: 0 },
    })
    await user.click(await within(panel).findByRole('button', { name: 'Desactivar cuenta' }))
    const dialog = await screen.findByRole('dialog', {
      name: `¿Desactivar la cuenta de ${daniela.name}?`,
    })
    const confirm = within(dialog).getByRole('button', { name: 'Desactivar cuenta' })
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(fetchAdminUser).toHaveBeenCalledWith(daniela.id, expect.anything())
    expect(within(dialog).queryByText(/casos abiertos/)).not.toBeInTheDocument()
    await user.click(confirm)
    expect(deactivateUser).toHaveBeenCalledWith(daniela.id, daniela.version)
  })

  it('deactivates someone without open cases', async () => {
    vi.mocked(deactivateUser).mockResolvedValue({
      changed: true,
      user: { ...mariana, status: 'inactive', version: 4 },
      revokedSessions: 2,
    })
    const { user } = renderUsers(`/administracion/usuarios?persona=${mariana.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await user.click(await within(panel).findByRole('button', { name: 'Desactivar cuenta' }))
    const dialog = await screen.findByRole('dialog', {
      name: '¿Desactivar la cuenta de Mariana Duque?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar cuenta' }))
    expect(deactivateUser).toHaveBeenCalledWith(mariana.id, mariana.version)
    expect(await screen.findAllByText('Cuenta desactivada')).toHaveLength(2) // toast title and the panel callout
    expect(
      screen.getByText('Mariana Duque ya no puede ingresar. Se cerraron sus 2 sesiones.'),
    ).toBeInTheDocument()
  })

  it('refetches the directory on directory.updated', async () => {
    const { sockets } = renderUsers()
    await screen.findByRole('table', { name: 'Personas' })
    sockets.last()?.open()
    expect(sockets.last()?.messages()).toContainEqual({
      action: 'subscribe',
      topic: 'admin:directory',
    })
    const calls = vi.mocked(fetchAdminUsers).mock.calls.length
    sockets.last()?.receive({
      type: 'directory.updated',
      id: 'EVT-DIR-1',
      occurredAt: NOW.toISOString(),
      data: {
        entity: 'staff',
        entityId: mariana.id,
        caseId: null,
        actor: null,
        payload: { staffIds: [mariana.id], teamIds: [] },
      },
    })
    await waitFor(() => expect(vi.mocked(fetchAdminUsers).mock.calls.length).toBeGreaterThan(calls))
  })
})
