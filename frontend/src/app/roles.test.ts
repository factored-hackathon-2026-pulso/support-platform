import { describe, expect, it } from 'vitest'
import {
  firstRoleHome,
  isNavItemActive,
  resolvePostLoginPath,
  roleFromPath,
  ROLE_LABEL,
  ROLE_ORDER,
  ROLES,
  rolesLabel,
  rolesNowCopy,
  sortRoles,
  presenceFor,
  type NavItem,
} from './roles'
import { adminTeamPath, supervisionCasePath } from './paths'

describe('roles', () => {
  it('has exactly three roles, in canonical order', () => {
    expect(ROLE_ORDER).toEqual(['analyst', 'supervisor', 'admin'])
    expect(Object.keys(ROLES).sort()).toEqual(['admin', 'analyst', 'supervisor'])
  })

  it('lists the destinations of each role', () => {
    expect(ROLES.analyst.nav.map((item) => item.label)).toEqual(['Inicio', 'Casos'])
    expect(ROLES.analyst.home).toBe('/analyst/home')
    expect(ROLES.analyst.nav[1]?.indicator).toBe('toReplyCases')
    // Slice 9: Colas (the landing, badge = cases nobody holds), Equipo, Escalados (badge =
    // open escalations), Auditoría; no team tabs anywhere.
    expect(ROLES.supervisor.label).toBe('Supervisión')
    expect(ROLES.supervisor.home).toBe('/supervision/queues')
    expect(ROLES.supervisor.nav.map((item) => [item.label, item.to, item.indicator])).toEqual([
      ['Colas', '/supervision/queues', 'queuedCases'],
      ['Equipo', '/supervision/team', undefined],
      ['Escalados', '/supervision/escalations', 'openEscalations'],
      ['Auditoría', '/supervision/audit', undefined],
    ])
    expect(ROLES.supervisor.nav[0]?.alsoActiveOn).toEqual(['/supervision/cases'])
    expect(ROLES.admin.nav.map((item) => item.label)).toEqual([
      'Usuarios y roles',
      'Equipos',
      'Auditoría',
      'Plataforma',
    ])
    expect(ROLES.admin.nav[0]?.indicator).toBe('lockedAccounts')
  })

  it('maps paths to the owning role', () => {
    expect(roleFromPath('/analyst/cases')).toBe('analyst')
    expect(roleFromPath('/supervision/audit')).toBe('supervisor')
    expect(roleFromPath('/admin')).toBe('admin')
    expect(roleFromPath('/analysts')).toBeNull()
    expect(roleFromPath('/customer')).toBeNull()
  })

  it('orders roles canonically and finds the first home', () => {
    expect(sortRoles(['admin', 'ghost', 'analyst'])).toEqual(['analyst', 'admin'])
    expect(sortRoles(['ghost', 'admin'])).toEqual(['admin'])
    expect(firstRoleHome(['admin', 'supervisor'])).toBe('/supervision/queues')
    expect(firstRoleHome([])).toBeNull()
  })

  it('names roles like the backend copy (copy.ROLE_LABEL) and says what she has now', () => {
    expect(ROLE_LABEL).toEqual({
      analyst: 'Analista',
      supervisor: 'Supervisión',
      admin: 'Administración',
    })
    expect(rolesLabel(['admin', 'ghost', 'analyst'])).toBe('Analista y Administración')
    expect(rolesLabel(['admin', 'supervisor', 'analyst'])).toBe(
      'Analista, Supervisión y Administración',
    )
    expect(rolesNowCopy(['analyst'])).toBe('Ahora tienes: Analista.')
  })

  it('marks an item active on its path, an `end` item only on the exact path', () => {
    const team: NavItem = ROLES.supervisor.nav[0]!
    expect(isNavItemActive(team, '/supervision/queues')).toBe(true)
    expect(isNavItemActive(team, '/supervision/audit')).toBe(false)
    const exact: NavItem = { ...team, end: true }
    expect(isNavItemActive(exact, '/supervision/queues/detail')).toBe(false)
    expect(isNavItemActive(team, '/supervision/cases/CASE-1')).toBe(true)
    expect(team.indicator).toBe('queuedCases')
  })

  it('marks only Inicio on /analyst/home and only Casos on /analyst/cases', () => {
    const [home, cases] = ROLES.analyst.nav
    expect(isNavItemActive(home!, '/analyst/home')).toBe(true)
    expect(isNavItemActive(cases!, '/analyst/home')).toBe(false)
    expect(isNavItemActive(cases!, '/analyst/cases')).toBe(true)
    expect(isNavItemActive(home!, '/analyst/cases')).toBe(false)
  })

  it('maps availability to the presence dot of the rail avatar', () => {
    expect(presenceFor('paused')).toEqual({ tone: 'warn', label: 'Estado: En pausa' })
    expect(presenceFor('available')).toEqual({ tone: 'success', label: 'Estado: Disponible' })
    expect(presenceFor(undefined)).toBeNull()
  })

  it('maps the built paths to their role', () => {
    expect(roleFromPath(supervisionCasePath('CASE-1'))).toBe('supervisor')
    expect(roleFromPath(adminTeamPath('TEAM-1').split('?')[0]!)).toBe('admin')
  })

  it('returns to the requested page only when the user may open it', () => {
    expect(resolvePostLoginPath(['supervisor'], '/supervision/audit?x=1')).toBe(
      '/supervision/audit?x=1',
    )
    expect(resolvePostLoginPath(['supervisor'], '/admin/users')).toBe('/supervision/queues')
    expect(resolvePostLoginPath(['analyst'], '//evil.example')).toBe('/analyst/home')
    expect(resolvePostLoginPath(['analyst'], null)).toBe('/analyst/home')
    expect(resolvePostLoginPath(['analyst'], '/analyst/cases?case=CASE-1')).toBe(
      '/analyst/cases?case=CASE-1',
    )
    expect(resolvePostLoginPath([], '/analyst/cases')).toBeNull()
  })
})
