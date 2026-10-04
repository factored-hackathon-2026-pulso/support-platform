import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import {
  andres,
  carolina,
  daniela,
  makeAdminTeam,
  makeAdminUser,
  mariana,
  selfAdmin,
} from '@/test/admin-fixtures'
import { NOW, minutesFrom } from '@/test/case-fixtures'
import { TEAM_PACIFICO } from '@/test/fixtures'
import {
  ACCOUNT_STATUS_LABEL,
  EMPTY_USERS_STATE,
  EMPTY_USER_DRAFT,
  FIELD_ERROR,
  LAST_ADMIN_HINT,
  ROLE_DESCRIPTION,
  SELF_CHANGE_COPY,
  accountStatusAt,
  addMemberCandidates,
  clearUserFilters,
  createUserBody,
  deactivatedToast,
  describeAdminFailure,
  draftFromUser,
  firstInvalidField,
  hasUserFilters,
  isDraftDirty,
  joinEs,
  languagesLabel,
  lockedUntilTitle,
  normalizeName,
  openCaseBlocks,
  openCasesFact,
  parseTeamsSearch,
  parseUsersSearch,
  reactivatedToast,
  readAdminTeam,
  readAdminUser,
  sortMembers,
  statusCallout,
  teamNotEmptyCopy,
  teamOptionLabel,
  teamsSubtitle,
  temporaryPasswordCopy,
  toTeamsSearch,
  toUsersSearch,
  toggleValue,
  unlockedToast,
  userChanges,
  userGuardState,
  userSummaryFacts,
  usersQueryOf,
  usersSubtitle,
  validateTeamName,
  validateUserDraft,
  type UserDraft,
} from './model'

const problem = (code: string, extensions: Record<string, unknown> = {}, status = 409) =>
  new ApiProblem({ status, code, extensions })

describe('labels', () => {
  it('pins the role descriptions and the account status labels', () => {
    expect(ROLE_DESCRIPTION.analyst).toBe('Atiende casos por chat con los clientes.')
    expect(ROLE_DESCRIPTION.admin).toBe('Crea y edita cuentas, roles, idiomas y equipos.')
    expect(ACCOUNT_STATUS_LABEL).toEqual({
      active: 'Activa',
      locked: 'Bloqueada',
      inactive: 'Desactivada',
    })
  })

  it('joins lists in Spanish like the backend join_es', () => {
    expect(joinEs([])).toBe('')
    expect(joinEs(['A'])).toBe('A')
    expect(joinEs(['A', 'B'])).toBe('A y B')
    expect(joinEs(['A', 'B', 'C'])).toBe('A, B y C')
  })

  it('names languages and teams', () => {
    expect(languagesLabel(['pt', 'es'])).toBe('español, portugués')
    expect(languagesLabel([])).toBe('—')
    expect(teamOptionLabel({ name: 'Equipo Caribe', active: false })).toBe(
      'Equipo Caribe (inactivo)',
    )
    expect(userSummaryFacts(daniela)).toEqual([
      { key: 'languages', icon: 'languages', text: 'Español y portugués', label: 'Idiomas' },
      { key: 'team', icon: 'users', text: 'Equipo Andes', label: 'Equipo' },
    ])
    expect(userSummaryFacts({ ...daniela, languages: [] })[0]?.text).toBe('Sin idiomas')
    expect(openCasesFact(daniela.openCases)).toBe('5 · 4 en español · 1 en portugués')
    expect(openCasesFact({ total: 0, es: 0, pt: 0 })).toBe('0')
    expect(usersSubtitle(13)).toBe('Quién puede hacer qué en la plataforma · 13 personas')
    expect(usersSubtitle(undefined)).toBe('Quién puede hacer qué en la plataforma')
    expect(teamsSubtitle(1)).toBe('Cómo se agrupan las personas en la plataforma · 1 equipo')
  })
})

describe('accountStatusAt', () => {
  it('recomputes the status at a pinned now: an expired lock reads active', () => {
    expect(accountStatusAt(mariana, NOW)).toBe('locked')
    expect(accountStatusAt(mariana, minutesFrom(14))).toBe('active')
    expect(accountStatusAt(andres, NOW)).toBe('inactive')
    expect(accountStatusAt(daniela, NOW)).toBe('active')
    // The server said active but a lock is still running (computed before a failed login).
    expect(accountStatusAt({ status: 'active', lockedUntil: minutesFrom(1) }, NOW)).toBe('locked')
    expect(lockedUntilTitle(minutesFrom(13))).toBe('Hasta las 11:13')
  })

  it('builds the status callout of the aside', () => {
    expect(statusCallout(mariana, NOW)).toEqual({
      tone: 'warn',
      title: 'Cuenta bloqueada',
      text: '5 intentos fallidos. Se desbloquea sola a las 11:13.',
      action: 'unlock',
    })
    expect(statusCallout(andres, NOW)).toEqual({
      tone: 'neutral',
      title: 'Cuenta desactivada',
      text: 'No puede ingresar.',
      action: 'reactivate',
    })
    expect(statusCallout(daniela, NOW)).toBeNull()
    expect(statusCallout(mariana, minutesFrom(20))).toBeNull()
  })
})

describe('URL state', () => {
  it('parses and serializes the users screen', () => {
    const params = new URLSearchParams(
      'rol=supervisoras&estado=bloqueadas&equipo=TEAM-1&idioma=pt&q=mar&persona=STF-1&nueva=1',
    )
    const state = parseUsersSearch(params)
    expect(state).toEqual({
      role: 'supervisor',
      status: 'locked',
      teamId: 'TEAM-1',
      language: 'pt',
      query: 'mar',
      staffId: 'STF-1',
      create: true,
    })
    expect(toUsersSearch(state).toString()).toBe(params.toString())
  })

  it('falls back to the defaults for unknown values', () => {
    const state = parseUsersSearch(
      new URLSearchParams('rol=automatizacion&estado=vacaciones&idioma=en&persona=%20&nueva=si'),
    )
    expect(state).toEqual(EMPTY_USERS_STATE)
    expect(toUsersSearch(state).toString()).toBe('')
    expect(parseUsersSearch(new URLSearchParams(`q=${'x'.repeat(100)}`)).query).toHaveLength(80)
  })

  it('parses and serializes the teams screen', () => {
    const state = parseTeamsSearch(new URLSearchParams('estado=inactivos&equipo=TEAM-4&nuevo=1'))
    expect(state).toEqual({ status: 'inactive', teamId: 'TEAM-4', create: true })
    expect(toTeamsSearch(state).toString()).toBe('estado=inactivos&equipo=TEAM-4&nuevo=1')
    expect(parseTeamsSearch(new URLSearchParams('estado=archivados'))).toEqual({
      status: 'active',
      teamId: null,
      create: false,
    })
    expect(toTeamsSearch({ status: 'active', teamId: null, create: false }).toString()).toBe('')
  })

  it('turns the URL into the list filters, defaults left out', () => {
    expect(usersQueryOf(EMPTY_USERS_STATE)).toEqual({})
    expect(
      usersQueryOf({
        ...EMPTY_USERS_STATE,
        role: 'admin',
        status: 'all',
        teamId: 'TEAM-1',
        language: 'es',
        query: '  Duque ',
        staffId: 'STF-1',
      }),
    ).toEqual({ role: 'admin', status: 'all', teamId: 'TEAM-1', language: 'es', q: 'Duque' })
  })

  it('knows when filters are set and clears them keeping the selection', () => {
    expect(hasUserFilters(EMPTY_USERS_STATE)).toBe(false)
    expect(hasUserFilters({ ...EMPTY_USERS_STATE, staffId: 'STF-1', create: true })).toBe(false)
    const filtered = { ...EMPTY_USERS_STATE, status: 'inactive' as const, staffId: 'STF-1' }
    expect(hasUserFilters(filtered)).toBe(true)
    expect(clearUserFilters(filtered)).toEqual({ ...EMPTY_USERS_STATE, staffId: 'STF-1' })
  })
})

describe('validateUserDraft', () => {
  const valid: UserDraft = {
    name: 'Ana Gil',
    email: 'ana.gil@latambank.example',
    roles: ['analyst'],
    languages: ['pt'],
    teamId: TEAM_PACIFICO.id,
  }

  it('accepts a valid draft', () => {
    expect(validateUserDraft(valid)).toEqual({})
  })

  it('checks every field, with the analyst-needs-a-language rule', () => {
    expect(validateUserDraft(EMPTY_USER_DRAFT)).toEqual({
      name: FIELD_ERROR.name,
      email: FIELD_ERROR.email,
      roles: FIELD_ERROR.roles,
      teamId: FIELD_ERROR.teamId,
    })
    expect(validateUserDraft({ ...valid, name: '  A  ' }).name).toBe(
      'Escribe el nombre completo (al menos 2 caracteres).',
    )
    expect(validateUserDraft({ ...valid, email: 'ana@' }).email).toBe(
      'Escribe un correo válido, como nombre@latambank.example.',
    )
    expect(validateUserDraft({ ...valid, languages: [] }).languages).toBe(
      'Quien atiende casos necesita al menos un idioma.',
    )
    // Without Analista, no language is fine.
    expect(validateUserDraft({ ...valid, roles: ['supervisor'], languages: [] })).toEqual({})
    expect(firstInvalidField({ teamId: 'x', email: 'y' })).toBe('email')
    expect(firstInvalidField({})).toBeNull()
  })

  it('validates and normalizes names', () => {
    expect(normalizeName('  Ana   Gil ')).toBe('Ana Gil')
    expect(validateTeamName(' x ')).toBe('Escribe un nombre de al menos 2 caracteres.')
    expect(validateTeamName('Equipo Sur')).toBeNull()
  })

  it('builds the create body in canonical order', () => {
    expect(
      createUserBody({
        ...valid,
        name: ' Ana  Gil ',
        email: ' ana.gil@latambank.example ',
        roles: ['admin', 'analyst'],
        languages: ['pt', 'es'],
      }),
    ).toEqual({
      name: 'Ana Gil',
      email: 'ana.gil@latambank.example',
      roles: ['analyst', 'admin'],
      languages: ['es', 'pt'],
      teamId: TEAM_PACIFICO.id,
    })
  })
})

describe('draft diff', () => {
  it('starts from the person and is clean', () => {
    const draft = draftFromUser(daniela)
    expect(draft).toEqual({
      name: daniela.name,
      email: daniela.email,
      roles: ['analyst'],
      languages: ['es', 'pt'],
      teamId: daniela.team.id,
    })
    expect(userChanges(daniela, draft)).toEqual({})
    expect(isDraftDirty(daniela, draft)).toBe(false)
  })

  it('sends only what changed, normalized; order and case are not changes', () => {
    const draft = draftFromUser(daniela)
    expect(
      isDraftDirty(daniela, {
        ...draft,
        name: ` ${daniela.name} `,
        email: daniela.email.toUpperCase(),
        languages: ['pt', 'es'],
      }),
    ).toBe(false)
    expect(
      userChanges(daniela, {
        ...draft,
        name: 'Daniela  Ríos',
        roles: ['supervisor', 'analyst'],
        languages: ['es'],
        teamId: TEAM_PACIFICO.id,
      }),
    ).toEqual({
      name: 'Daniela Ríos',
      roles: ['analyst', 'supervisor'],
      languages: ['es'],
      teamId: TEAM_PACIFICO.id,
    })
    expect(toggleValue(['es'], 'pt', true)).toEqual(['es', 'pt'])
    expect(toggleValue(['es', 'pt'], 'es', false)).toEqual(['pt'])
    expect(toggleValue(['es'], 'es', true)).toEqual(['es'])
  })
})

describe('guard rails', () => {
  it('blocks the own admin role, deactivating and resetting oneself', () => {
    expect(userGuardState(selfAdmin)).toEqual({
      adminLocked: 'No puedes quitarte tu propio rol de Administración.',
      deactivateBlocked: 'No puedes desactivar tu propia cuenta.',
      resetBlocked: 'Pídele a otra persona de Administración que restablezca tu contraseña.',
    })
  })

  it('protects the last active admin', () => {
    const last = { ...carolina, guards: { isSelf: false, lastActiveAdmin: true } }
    expect(userGuardState(last)).toEqual({
      adminLocked: LAST_ADMIN_HINT,
      deactivateBlocked: 'Es la única persona activa con Administración.',
      resetBlocked: null,
    })
    expect(userGuardState(daniela)).toEqual({
      adminLocked: null,
      deactivateBlocked: null,
      resetBlocked: null,
    })
  })

  it('blocks removing Analista or a language of open cases, by language', () => {
    const draft = draftFromUser(daniela)
    expect(openCaseBlocks(daniela, { ...draft, roles: ['supervisor'] })).toEqual({
      roles:
        'Tiene 5 casos abiertos: supervisión tiene que reasignarlos antes de quitarle el rol de Analista.',
    })
    expect(openCaseBlocks(daniela, { ...draft, languages: ['es'] })).toEqual({
      languages:
        'Tiene 1 caso abierto en portugués: supervisión tiene que reasignarlos antes de quitarle ese idioma.',
    })
    expect(openCaseBlocks(daniela, { ...draft, languages: ['pt'] }).languages).toBe(
      'Tiene 4 casos abiertos en español: supervisión tiene que reasignarlos antes de quitarle ese idioma.',
    )
    // No open cases in that language, or adding things: never blocked.
    const esOnly = makeAdminUser({ languages: ['es', 'pt'], openCases: { total: 2, es: 2, pt: 0 } })
    expect(openCaseBlocks(esOnly, { ...draftFromUser(esOnly), languages: ['es'] })).toEqual({})
    expect(
      openCaseBlocks(daniela, { ...draft, roles: ['analyst', 'supervisor', 'admin'] }),
    ).toEqual({})
  })
})

describe('describeAdminFailure', () => {
  const user = { subject: 'user' as const }
  const team = { subject: 'team' as const }

  it('version_conflict: uses the current record, per subject', () => {
    expect(describeAdminFailure(problem('version_conflict'), user)).toEqual({
      message:
        'Alguien más cambió a esta persona mientras editabas. Cargamos los datos actuales: revisa y vuelve a guardar.',
      action: 'use_current',
    })
    expect(describeAdminFailure(problem('version_conflict'), team).message).toBe(
      'Alguien más cambió este equipo mientras editabas. Cargamos los datos actuales: revisa y vuelve a guardar.',
    )
  })

  it('maps the field errors', () => {
    expect(describeAdminFailure(problem('email_taken'), user)).toEqual({
      message: 'Ya existe una cuenta con ese correo.',
      field: 'email',
      action: 'none',
    })
    expect(describeAdminFailure(problem('team_name_taken'), team)).toEqual({
      message: 'Ya existe un equipo con ese nombre.',
      field: 'name',
      action: 'none',
    })
    expect(describeAdminFailure(problem('team_inactive', {}, 422), user)).toEqual({
      message: 'Ese equipo está desactivado. Elige otro.',
      field: 'teamId',
      action: 'refetch_teams',
    })
    expect(describeAdminFailure(problem('invalid_value', { field: 'teamId' }, 422), user)).toEqual({
      message: FIELD_ERROR.teamId,
      field: 'teamId',
      action: 'none',
    })
    expect(describeAdminFailure(problem('invalid_value', { field: 'name' }, 422), team)).toEqual({
      message: 'Escribe un nombre de al menos 2 caracteres.',
      field: 'name',
      action: 'none',
    })
  })

  it('says each self change in its own words', () => {
    for (const action of ['remove_own_admin', 'deactivate_self', 'reset_own_password'] as const) {
      expect(
        describeAdminFailure(problem('self_change_forbidden', { action }, 422), user).message,
      ).toBe(SELF_CHANGE_COPY[action])
    }
  })

  it('explains the open-case blocks by reason', () => {
    expect(
      describeAdminFailure(
        problem('staff_has_open_cases', { blockReason: 'deactivate', openCases: 5 }),
        user,
      ),
    ).toEqual({
      message:
        'Tiene 5 casos abiertos. Supervisión tiene que reasignarlos antes de desactivar la cuenta.',
      action: 'refetch',
    })
    expect(
      describeAdminFailure(
        problem('staff_has_open_cases', { blockReason: 'remove_analyst', openCases: 2 }),
        user,
      ).field,
    ).toBe('roles')
    expect(
      describeAdminFailure(
        problem('staff_has_open_cases', {
          blockReason: 'remove_language',
          openCases: 1,
          caseLanguage: 'pt',
          caseIds: ['CASE-1'],
        }),
        user,
      ),
    ).toEqual({
      message:
        'Tiene 1 caso abierto en portugués: supervisión tiene que reasignarlos antes de quitarle ese idioma.',
      field: 'languages',
      action: 'refetch',
    })
  })

  it('covers the remaining codes and falls back to a generic message', () => {
    expect(describeAdminFailure(problem('last_admin'), user)).toEqual({
      message: 'Debe quedar al menos una persona activa con Administración.',
      action: 'refetch',
    })
    expect(describeAdminFailure(problem('team_not_empty', { memberCount: 4 }), team)).toEqual({
      message: 'Para desactivarlo, primero mueve a sus 4 personas a otro equipo.',
      action: 'refetch',
    })
    expect(teamNotEmptyCopy(1)).toBe('Para desactivarlo, primero mueve a su persona a otro equipo.')
    expect(describeAdminFailure(problem('staff_inactive'), user)).toEqual({
      message: 'Esta cuenta está desactivada. Reactívala primero.',
      action: 'refetch',
    })
    expect(describeAdminFailure(ApiProblem.network(), user)).toEqual({
      message: 'No pudimos guardar los cambios. Inténtalo de nuevo.',
      action: 'none',
    })
    expect(describeAdminFailure(new Error('boom'), user).action).toBe('none')
  })

  it('reads the current record of a conflict, or rejects a malformed one', () => {
    expect(readAdminUser(daniela)).toBe(daniela)
    expect(readAdminUser({ id: 'STF-1' })).toBeNull()
    expect(readAdminUser(null)).toBeNull()
    const andes = makeAdminTeam()
    expect(readAdminTeam(andes)).toBe(andes)
    expect(readAdminTeam({ id: 'TEAM-1', name: 'x' })).toBeNull()
  })
})

describe('toasts and dialogs', () => {
  it('words each account action', () => {
    expect(deactivatedToast('Daniela Ríos', 0)).toEqual({
      title: 'Cuenta desactivada',
      description: 'Daniela Ríos ya no puede ingresar.',
    })
    expect(deactivatedToast('Daniela Ríos', 1).description).toBe(
      'Daniela Ríos ya no puede ingresar. Se cerró su sesión.',
    )
    expect(deactivatedToast('Daniela Ríos', 2).description).toBe(
      'Daniela Ríos ya no puede ingresar. Se cerraron sus 2 sesiones.',
    )
    expect(reactivatedToast('Andrés Villamil').description).toBe(
      'Andrés Villamil puede volver a ingresar con su contraseña. Empieza En pausa.',
    )
    expect(unlockedToast('Mariana Duque', true)).toEqual({
      title: 'Cuenta desbloqueada',
      description: 'Mariana Duque ya puede volver a intentar ingresar.',
    })
    expect(unlockedToast('Mariana Duque', false)).toEqual({
      title: 'La cuenta ya no estaba bloqueada.',
    })
    expect(temporaryPasswordCopy('Ana Gil', 'created')).toEqual({
      title: 'Cuenta creada',
      text: 'Ana Gil ya puede ingresar con su correo y esta contraseña temporal. Cópiala ahora: no la volveremos a mostrar.',
    })
    expect(temporaryPasswordCopy('Ana Gil', 'reset').title).toBe('Contraseña restablecida')
  })
})

describe('teams', () => {
  it('offers active people of other teams to "Agregar persona"', () => {
    const candidates = addMemberCandidates([daniela, mariana, andres, carolina], daniela.team.id)
    expect(candidates.map((c) => c.label)).toEqual([
      'Carolina Peña Ruiz · Administración de la plataforma',
      'Mariana Duque · Equipo Pacífico',
    ])
  })

  it('lists active members first, each by name', () => {
    const members = sortMembers([
      { id: 'STF-3', name: 'Zoe', roles: ['analyst'], languages: ['es'], status: 'active' },
      { id: 'STF-2', name: 'Ana', roles: ['analyst'], languages: ['es'], status: 'inactive' },
      { id: 'STF-1', name: 'Álvaro', roles: ['analyst'], languages: ['es'], status: 'locked' },
    ])
    expect(members.map((m) => m.name)).toEqual(['Álvaro', 'Zoe', 'Ana'])
  })
})
