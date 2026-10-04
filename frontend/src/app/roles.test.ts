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
  adminAuditPath,
  adminTeamPath,
  adminUserPath,
  supervisionAnalystPath,
  supervisionCasePath,
  presenceFor,
  workspacePath,
  type NavItem,
} from './roles'

describe('roles', () => {
  it('has exactly three roles, in canonical order', () => {
    expect(ROLE_ORDER).toEqual(['analyst', 'supervisor', 'admin'])
    expect(Object.keys(ROLES).sort()).toEqual(['admin', 'analyst', 'supervisor'])
  })

  it('lists the destinations of each role', () => {
    expect(ROLES.analyst.nav.map((item) => item.label)).toEqual(['Inicio', 'Casos'])
    expect(ROLES.analyst.home).toBe('/analista/inicio')
    expect(ROLES.analyst.nav[1]?.indicator).toBe('toReplyCases')
    expect(ROLES.supervisor.nav.map((item) => item.label)).toEqual(['Equipo y colas', 'Auditoría'])
    expect(ROLES.admin.nav.map((item) => item.label)).toEqual([
      'Usuarios y roles',
      'Equipos',
      'Auditoría',
    ])
    expect(ROLES.admin.nav[0]?.indicator).toBe('lockedAccounts')
  })

  it('maps paths to the owning role', () => {
    expect(roleFromPath('/analista')).toBe('analyst')
    expect(roleFromPath('/supervision/auditoria')).toBe('supervisor')
    expect(roleFromPath('/administracion')).toBe('admin')
    expect(roleFromPath('/analistas')).toBeNull()
    expect(roleFromPath('/cliente')).toBeNull()
  })

  it('orders roles canonically and finds the first home', () => {
    expect(sortRoles(['admin', 'ghost', 'analyst'])).toEqual(['analyst', 'admin'])
    expect(sortRoles(['ghost', 'admin'])).toEqual(['admin'])
    expect(firstRoleHome(['admin', 'supervisor'])).toBe('/supervision/equipo')
    expect(firstRoleHome([])).toBeNull()
  })

  it('names roles like the backend copy (copy.ROLE_LABEL) and says what she has now', () => {
    expect(ROLE_LABEL).toEqual({
      analyst: 'Analista',
      supervisor: 'Supervisora',
      admin: 'Administración',
    })
    expect(rolesLabel(['admin', 'ghost', 'analyst'])).toBe('Analista y Administración')
    expect(rolesLabel(['admin', 'supervisor', 'analyst'])).toBe(
      'Analista, Supervisora y Administración',
    )
    expect(rolesNowCopy(['analyst'])).toBe('Ahora tienes: Analista.')
  })

  it('marks an item active on its path, an `end` item only on the exact path', () => {
    const team: NavItem = ROLES.supervisor.nav[0]!
    expect(isNavItemActive(team, '/supervision/equipo')).toBe(true)
    expect(isNavItemActive(team, '/supervision/auditoria')).toBe(false)
    const exact: NavItem = { ...team, end: true }
    expect(isNavItemActive(exact, '/supervision/equipo/detalle')).toBe(false)
    expect(isNavItemActive(team, '/supervision/casos/CASE-1')).toBe(true)
    expect(team.indicator).toBe('queuedCases')
  })

  it('marks only Inicio on /analista/inicio and only Casos on /analista', () => {
    const [home, cases] = ROLES.analyst.nav
    expect(isNavItemActive(home!, '/analista/inicio')).toBe(true)
    expect(isNavItemActive(cases!, '/analista/inicio')).toBe(false)
    expect(isNavItemActive(cases!, '/analista')).toBe(true)
    expect(isNavItemActive(home!, '/analista')).toBe(false)
  })

  it('builds the Workspace path with a case and a filter', () => {
    expect(workspacePath()).toBe('/analista')
    expect(workspacePath({ filterSlug: 'cerrados' })).toBe('/analista?estado=cerrados')
    expect(workspacePath({ caseId: 'CASE-1', filterSlug: 'por-responder' })).toBe(
      '/analista?caso=CASE-1&estado=por-responder',
    )
    expect(workspacePath({ caseId: 'CASE-1', filterSlug: null })).toBe('/analista?caso=CASE-1')
  })

  it('maps availability to the presence dot of the rail avatar', () => {
    expect(presenceFor('paused')).toEqual({ tone: 'warn', label: 'Estado: En pausa' })
    expect(presenceFor('available')).toEqual({ tone: 'success', label: 'Estado: Disponible' })
    expect(presenceFor(undefined)).toBeNull()
  })

  it('builds the supervisor case path', () => {
    expect(supervisionCasePath('CASE-1')).toBe('/supervision/casos/CASE-1')
    expect(roleFromPath(supervisionCasePath('CASE-1'))).toBe('supervisor')
  })

  it('builds the administration paths', () => {
    expect(adminUserPath('STF-1')).toBe('/administracion/usuarios?persona=STF-1')
    expect(adminTeamPath('TEAM-1')).toBe('/administracion/equipos?equipo=TEAM-1')
    expect(adminAuditPath('STF-1')).toBe('/administracion/auditoria?q=STF-1')
    expect(supervisionAnalystPath('STF-1')).toBe('/supervision/equipo?analista=STF-1')
    expect(roleFromPath(adminTeamPath('TEAM-1').split('?')[0]!)).toBe('admin')
  })

  it('returns to the requested page only when the user may open it', () => {
    expect(resolvePostLoginPath(['supervisor'], '/supervision/auditoria?x=1')).toBe(
      '/supervision/auditoria?x=1',
    )
    expect(resolvePostLoginPath(['supervisor'], '/administracion/usuarios')).toBe(
      '/supervision/equipo',
    )
    expect(resolvePostLoginPath(['analyst'], '//evil.example')).toBe('/analista/inicio')
    expect(resolvePostLoginPath(['analyst'], null)).toBe('/analista/inicio')
    expect(resolvePostLoginPath(['analyst'], '/analista?caso=CASE-1')).toBe('/analista?caso=CASE-1')
    expect(resolvePostLoginPath([], '/analista')).toBeNull()
  })
})
