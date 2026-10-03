import { describe, expect, it } from 'vitest'
import {
  firstRoleHome,
  isNavItemActive,
  resolvePostLoginPath,
  roleFromPath,
  ROLE_ORDER,
  ROLES,
  sortRoles,
  supervisionCasePath,
  type NavItem,
} from './roles'

describe('roles', () => {
  it('has exactly three roles, in canonical order', () => {
    expect(ROLE_ORDER).toEqual(['analyst', 'supervisor', 'admin'])
    expect(Object.keys(ROLES).sort()).toEqual(['admin', 'analyst', 'supervisor'])
  })

  it('lists the destinations of each role', () => {
    expect(ROLES.analyst.nav.map((item) => item.label)).toEqual(['Casos'])
    expect(ROLES.supervisor.nav.map((item) => item.label)).toEqual(['Equipo y colas', 'Auditoría'])
    expect(ROLES.admin.nav.map((item) => item.label)).toEqual(['Usuarios y roles'])
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

  it('marks an item active on its path, an `end` item only on the exact path', () => {
    const team: NavItem = ROLES.supervisor.nav[0]!
    expect(isNavItemActive(team, '/supervision/equipo')).toBe(true)
    expect(isNavItemActive(team, '/supervision/auditoria')).toBe(false)
    const exact: NavItem = { ...team, end: true }
    expect(isNavItemActive(exact, '/supervision/equipo/detalle')).toBe(false)
    expect(isNavItemActive(team, '/supervision/casos/CASE-1')).toBe(true)
    expect(team.indicator).toBe('queuedCases')
  })

  it('builds the supervisor case path', () => {
    expect(supervisionCasePath('CASE-1')).toBe('/supervision/casos/CASE-1')
    expect(roleFromPath(supervisionCasePath('CASE-1'))).toBe('supervisor')
  })

  it('returns to the requested page only when the user may open it', () => {
    expect(resolvePostLoginPath(['supervisor'], '/supervision/auditoria?x=1')).toBe(
      '/supervision/auditoria?x=1',
    )
    expect(resolvePostLoginPath(['supervisor'], '/administracion/usuarios')).toBe(
      '/supervision/equipo',
    )
    expect(resolvePostLoginPath(['analyst'], '//evil.example')).toBe('/analista')
    expect(resolvePostLoginPath(['analyst'], null)).toBe('/analista')
    expect(resolvePostLoginPath([], '/analista')).toBeNull()
  })
})
