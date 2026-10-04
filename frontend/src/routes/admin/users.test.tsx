import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AdminApi from '@/features/admin/api'
import {
  createUser,
  deactivateUser,
  fetchAdminTeams,
  fetchAdminUser,
  fetchAdminUsers,
  cancelInvitation,
  reactivateUser,
  resendInvitation,
  sendPasswordResetLink,
  unlockUser,
  updateUser,
} from '@/features/admin/api'
import { ApiProblem } from '@/lib/api'
import {
  andres,
  bruna,
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
    sendPasswordResetLink: vi.fn<typeof actual.sendPasswordResetLink>(),
    resendInvitation: vi.fn<typeof actual.resendInvitation>(),
    cancelInvitation: vi.fn<typeof actual.cancelInvitation>(),
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

function renderUsers(path = '/admin/users', staff = adminStaff) {
  return renderRoute(path, { staff })
}

const table = () => screen.getByRole('table', { name: 'Personas' })
const row = (name: RegExp) => within(table()).getByRole('row', { name })
const aside = () => screen.getByRole('complementary', { name: 'Persona seleccionada' })
const search = (router: { state: { location: { search: string } } }) =>
  new URLSearchParams(router.state.location.search)

describe('users and roles screen ("Usuarios y roles")', () => {
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
    // Her languages as one mark (one globe, then the codes), named for screen readers.
    expect(
      within(danielaRow).getByText('Español y Português', { selector: '.sr-only' }),
    ).toBeInTheDocument()
    expect(danielaRow).toHaveTextContent(/ESPT/)
    expect(danielaRow.querySelectorAll('[data-languages="es pt"] svg')).toHaveLength(1)
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
    expect(within(panel).getByRole('checkbox', { name: 'Português 1' })).toBeInTheDocument()

    await user.click(within(panel).getByRole('checkbox', { name: 'Supervisión 2' }))
    expect(router.state.location.search).toBe('?role=supervisor')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(within(table()).queryByRole('row', { name: /Daniela Ríos Medina/ })).toBeNull()
    expect(row(/Carolina Peña Ruiz/)).toBeInTheDocument()
    expect(screen.getByText('2 de 4 personas')).toBeInTheDocument()
    // The other groups count only supervisors now.
    expect(within(panel).getByRole('checkbox', { name: 'Activa 1' })).toBeInTheDocument()
    await user.click(within(panel).getByRole('checkbox', { name: 'Bloqueada 1' }))
    expect(search(router).get('status')).toBe('locked')
    expect(within(table()).getAllByRole('row')).toHaveLength(2) // header + Mariana
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Filtros 2 activos' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Quitar filtro Supervisión' }))
    expect(router.state.location.search).toBe('?status=locked')
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
    const { user, router } = renderUsers('/admin/users?status=locked&language=pt')
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
    expect(search(router).get('person')).toBe(mariana.id)
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
    const { user } = renderUsers(`/admin/users?person=${andres.id}`)
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
    renderUsers('/admin/users?person=STF-NADIE')
    expect(await screen.findByText('No encontramos a esa persona.')).toBeInTheDocument()
  })

  it('protects the admin herself: her own Administración, deactivation and password', async () => {
    renderUsers(`/admin/users?person=${selfAdmin.id}`)
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
    expect(
      within(panel).getByRole('button', { name: 'Enviar enlace para restablecer' }),
    ).toBeDisabled()
    expect(
      within(panel).getByText(
        'Pídele a otra persona de Administración que te envíe un enlace para restablecer tu contraseña.',
      ),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Ver en auditoría' })).toHaveAttribute(
      'href',
      `/admin/audit?q=${selfAdmin.id}`,
    )
  })

  it('blocks removing a language or Analista while she holds open cases (no request)', async () => {
    const { user } = renderUsers(`/admin/users?person=${daniela.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await within(panel).findByRole('heading', { name: daniela.name })
    expect(within(panel).getByText('5 (4 en español y 1 en portugués)')).toBeInTheDocument()
    expect(within(panel).getByText('Disponible')).toBeInTheDocument()
    const save = within(panel).getByRole('button', { name: 'Guardar cambios' })
    expect(save).toBeDisabled()

    await user.click(within(panel).getByRole('checkbox', { name: 'Português' }))
    expect(save).toBeEnabled()
    await user.click(save)
    const portuguese = within(panel).getByRole('checkbox', { name: 'Português' })
    // It asks again first (the count may be stale); the server still says 1.
    await waitFor(() =>
      expect(portuguese).toHaveAccessibleDescription(
        expect.stringContaining(
          'Tiene 1 caso abierto en portugués: supervisión tiene que reasignarlos antes de quitarle ese idioma.',
        ),
      ),
    )
    expect(within(panel).getByRole('checkbox', { name: 'Español' })).toHaveFocus()

    await user.click(within(panel).getByRole('checkbox', { name: 'Português' }))
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
    const { user } = renderUsers(`/admin/users?person=${daniela.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await within(panel).findByRole('heading', { name: daniela.name })
    // Supervision moved her Portuguese case away; this screen did not hear about it.
    vi.mocked(fetchAdminUser).mockResolvedValue({
      ...daniela,
      openCases: { total: 4, es: 4, pt: 0 },
    })
    await user.click(within(panel).getByRole('checkbox', { name: 'Português' }))
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
    const { user } = renderUsers(`/admin/users?person=${daniela.id}`)
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
    const { user } = renderUsers(`/admin/users?person=${daniela.id}`)
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
    const { user, queryClient } = renderUsers(`/admin/users?person=${daniela.id}`)
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

  it('invites a person by email: no password is ever shown', async () => {
    const ana = {
      ...daniela,
      id: 'STF-NEW0000001',
      name: 'Ana Gil',
      email: 'ana.gil@latambank.example',
      languages: ['pt' as const],
      team: TEAM_PACIFICO,
      version: 1,
      openCases: { total: 0, es: 0, pt: 0 },
      status: 'invited' as const,
      lastLoginAt: null,
      secondFactor: null,
      invitation: { ...bruna.invitation!, sentAt: NOW.toISOString() },
    }
    vi.mocked(createUser).mockResolvedValue({ user: ana })
    vi.mocked(fetchAdminUser).mockResolvedValue(ana)
    const { user, router } = renderUsers()
    await screen.findByRole('table', { name: 'Personas' })
    await user.click(screen.getByRole('button', { name: 'Nuevo usuario' }))
    expect(search(router).get('new')).toBe('1')
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' })
    expect(within(dialog).getByText('Le llega una invitación por correo')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Con el enlace crea su contraseña y configura la verificación en dos pasos. Nadie más ve su contraseña. El enlace vence en 48 horas.',
      ),
    ).toBeInTheDocument()

    // Empty form: client validation, first invalid control focused, no request.
    await user.click(within(dialog).getByRole('button', { name: 'Enviar invitación' }))
    expect(within(dialog).getByRole('textbox', { name: 'Nombre completo' })).toHaveFocus()
    expect(within(dialog).getByText('Elige al menos un rol.')).toBeInTheDocument()
    expect(createUser).not.toHaveBeenCalled()

    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre completo' }), 'Ana Gil')
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Correo' }),
      'ana.gil@latambank.example',
    )
    await user.click(within(dialog).getByRole('checkbox', { name: /^Analista/ }))
    // Languages are option cards: only the language's own name, a native checkbox
    // inside each card (keyboard included) and a round check when selected.
    const spanish = within(dialog).getByRole('checkbox', { name: 'Español' })
    const card = spanish.closest('label')!
    expect(card.querySelector('svg')).toBeNull()
    expect(within(dialog).getByRole('checkbox', { name: 'Português' })).toBeInTheDocument()
    spanish.focus()
    await user.keyboard(' ')
    expect(spanish).toBeChecked()
    expect(card.querySelectorAll('svg')).toHaveLength(1)
    await user.click(spanish)
    expect(spanish).not.toBeChecked()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Português' }))
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Equipo' }),
      TEAM_PACIFICO.id,
    )
    expect(within(dialog).queryByRole('option', { name: /Equipo Caribe/ })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Enviar invitación' }))

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
    const sent = await screen.findByRole('dialog', { name: 'Invitación enviada' })
    expect(sent).toHaveTextContent(
      'Invitación enviada a ana.gil@latambank.example. El enlace vence en 48 horas.',
    )
    for (const line of [
      'Crea su propia contraseña',
      'Configura la verificación en dos pasos',
      'Su cuenta queda activa y empieza En pausa',
      'Mientras tanto aparece como Invitación pendiente. Puedes reenviarla o cancelarla desde su ficha.',
    ]) {
      expect(within(sent).getByText(line)).toBeInTheDocument()
    }
    expect(within(sent).queryByText(/contraseña temporal|000000/)).not.toBeInTheDocument()
    expect(search(router).get('person')).toBe(ana.id)
    expect(search(router).get('new')).toBeNull()
    await user.click(within(sent).getByRole('button', { name: 'Listo' }))
    expect(screen.queryByRole('dialog', { name: 'Invitación enviada' })).not.toBeInTheDocument()
    // Her aside: "Invitación pendiente", the invitation facts and its actions.
    const panel = aside()
    expect(await within(panel).findByText('Invitación pendiente')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Reenviar invitación' })).toBeInTheDocument()
  })

  it('shows the same "Invitación enviada" on an idempotent replay', async () => {
    vi.mocked(createUser).mockResolvedValue({ user: bruna })
    vi.mocked(fetchAdminUser).mockResolvedValue(bruna)
    const { user } = renderUsers('/admin/users?new=1')
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre completo' }), bruna.name)
    await user.type(within(dialog).getByRole('textbox', { name: 'Correo' }), bruna.email)
    await user.click(within(dialog).getByRole('checkbox', { name: /^Analista/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Português' }))
    await waitFor(() => expect(within(dialog).getAllByRole('option').length).toBeGreaterThan(1))
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Equipo' }),
      bruna.team.id,
    )
    await user.click(within(dialog).getByRole('button', { name: 'Enviar invitación' }))
    const sent = await screen.findByRole('dialog', { name: 'Invitación enviada' })
    expect(sent).toHaveTextContent(`Invitación enviada a ${bruna.email}.`)
  })

  it('shows email_taken on the Correo field', async () => {
    vi.mocked(createUser).mockRejectedValue(
      new ApiProblem({ status: 409, code: 'email_taken', extensions: { field: 'email' } }),
    )
    const { user } = renderUsers('/admin/users?new=1')
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre completo' }), 'Ana Gil')
    await user.type(within(dialog).getByRole('textbox', { name: 'Correo' }), daniela.email)
    await user.click(within(dialog).getByRole('checkbox', { name: /^Supervisión/ }))
    await waitFor(() => expect(within(dialog).getAllByRole('option').length).toBeGreaterThan(1))
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Equipo' }),
      TEAM_PACIFICO.id,
    )
    await user.click(within(dialog).getByRole('button', { name: 'Enviar invitación' }))
    const email = within(dialog).getByRole('textbox', { name: 'Correo' })
    await waitFor(() => expect(email).toHaveFocus())
    expect(email).toHaveAccessibleDescription('Ya existe una cuenta con ese correo.')
  })

  it('shows an invited person: the invitation facts, resend and cancel', async () => {
    vi.mocked(fetchAdminUsers).mockResolvedValue(
      makeUserList([carolina, daniela, bruna, selfAdmin]),
    )
    vi.mocked(resendInvitation).mockResolvedValue({
      changed: true,
      user: { ...bruna, version: 4 },
      revokedSessions: 0,
    })
    vi.mocked(cancelInvitation).mockResolvedValue({
      changed: true,
      user: { ...bruna, status: 'cancelled', invitation: null, version: 5 },
      revokedSessions: 0,
    })
    const { user, router } = renderUsers(`/admin/users?person=${bruna.id}`)
    await screen.findByRole('table', { name: 'Personas' })
    expect(row(/Bruna Esteves/)).toHaveTextContent('Invitación pendiente')
    const panel = aside()
    expect(await within(panel).findByText('Invitación enviada')).toBeInTheDocument()
    expect(within(panel).getByText('hace 3 h')).toBeInTheDocument()
    expect(within(panel).getByText('Vence')).toBeInTheDocument()
    expect(within(panel).getByText('en 45 h')).toBeInTheDocument()
    expect(within(panel).getByText('Nunca')).toBeInTheDocument()
    // No password paths and no deactivation for someone who never activated.
    expect(within(panel).queryByRole('button', { name: /restablecer/i })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Desactivar cuenta' })).toBeNull()

    await user.click(within(panel).getByRole('button', { name: 'Reenviar invitación' }))
    expect(resendInvitation).toHaveBeenCalledWith(bruna.id)
    expect(await screen.findByText('Invitación reenviada')).toBeInTheDocument()
    expect(
      screen.getByText(
        `Le enviamos un enlace nuevo a ${bruna.email}. Vence en 48 horas y el anterior ya no funciona.`,
      ),
    ).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Cancelar invitación' }))
    const confirm = await screen.findByRole('dialog', {
      name: '¿Cancelar la invitación de Bruna Esteves?',
    })
    expect(
      within(confirm).getByText(
        'El enlace que le enviamos deja de funcionar y la cuenta no se crea. Si hace falta, puedes invitarle de nuevo.',
      ),
    ).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar invitación' }))
    expect(cancelInvitation).toHaveBeenCalledWith(bruna.id)
    expect(await screen.findByText('Invitación cancelada')).toBeInTheDocument()
    expect(
      screen.getByText('El enlace que recibió Bruna Esteves ya no funciona.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(search(router).get('person')).toBeNull())
  })

  it('says when an invitation expired', async () => {
    const expired = {
      ...bruna,
      invitation: {
        ...bruna.invitation!,
        status: 'expired' as const,
        sentAt: new Date(NOW.getTime() - 50 * 3_600_000).toISOString(),
        expiresAt: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(),
      },
    }
    vi.mocked(fetchAdminUser).mockResolvedValue(expired)
    renderUsers(`/admin/users?person=${bruna.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    expect(await within(panel).findByText('La invitación venció')).toBeInTheDocument()
    expect(within(panel).getByText('Venció')).toBeInTheDocument()
    expect(within(panel).getByText('hace 2 h')).toBeInTheDocument()
  })

  it('sends a reset link: the sessions end, nobody sees a password', async () => {
    vi.mocked(sendPasswordResetLink).mockResolvedValue({
      user: { ...mariana, status: 'active', lockedUntil: null, version: 4 },
      revokedSessions: 1,
      expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    })
    const { user } = renderUsers(`/admin/users?person=${mariana.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await user.click(
      await within(panel).findByRole('button', { name: 'Enviar enlace para restablecer' }),
    )
    const confirm = await screen.findByRole('dialog', {
      name: '¿Enviar a Mariana Duque un enlace para restablecer su contraseña?',
    })
    for (const line of [
      `Le llega un correo a ${mariana.email} con un enlace para crear una contraseña nueva. Vence en 1 hora.`,
      'Se cierran sus sesiones abiertas ahora.',
      'Si la cuenta estaba bloqueada, se desbloquea.',
      'Nadie del equipo ve la contraseña nueva.',
    ]) {
      expect(within(confirm).getByText(line)).toBeInTheDocument()
    }
    await user.click(within(confirm).getByRole('button', { name: 'Enviar enlace' }))
    expect(sendPasswordResetLink).toHaveBeenCalledWith(mariana.id)
    expect(await screen.findByText('Enlace enviado')).toBeInTheDocument()
    expect(
      screen.getByText(
        `Le enviamos a ${mariana.email} un enlace para crear una contraseña nueva. Sus sesiones abiertas se cerraron.`,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('blocks deactivating someone with open cases; only a supervisor-admin gets the link', async () => {
    const { user, unmount } = renderUsers(`/admin/users?person=${daniela.id}`)
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
    const second = renderUsers(`/admin/users?person=${daniela.id}`, supervisorAdminStaff)
    panel = await screen.findByRole('complementary', { name: 'Persona seleccionada' })
    await second.user.click(await within(panel).findByRole('button', { name: 'Desactivar cuenta' }))
    dialog = await screen.findByRole('dialog', {
      name: `¿Desactivar la cuenta de ${daniela.name}?`,
    })
    expect(within(dialog).getByRole('link', { name: 'Ver en Equipo' })).toHaveAttribute(
      'href',
      `/supervision/team?analyst=${daniela.id}`,
    )
  })

  it('re-reads her open cases on open: a block supervision already cleared is gone', async () => {
    vi.mocked(deactivateUser).mockResolvedValue({
      changed: true,
      user: { ...daniela, status: 'inactive', openCases: { total: 0, es: 0, pt: 0 } },
      revokedSessions: 1,
    })
    const { user } = renderUsers(`/admin/users?person=${daniela.id}`)
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
    const { user } = renderUsers(`/admin/users?person=${mariana.id}`)
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
