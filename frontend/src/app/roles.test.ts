import { describe, expect, it } from 'vitest'
import {
  firstRoleHome,
  isNavItemActive,
  resolvePostLoginPath,
  roleFromPath,
  ROLES,
  sortRoles,
} from './roles'

const agents = ROLES.automation.nav.find((item) => item.label === 'Agentes')!
const panorama = ROLES.automation.nav.find((item) => item.label === 'Panorama')!

describe('roles', () => {
  it('maps paths to the owning role', () => {
    expect(roleFromPath('/analista')).toBe('analyst')
    expect(roleFromPath('/supervision/aprobaciones')).toBe('supervisor')
    expect(roleFromPath('/automatizacion/sandbox/CMP-1')).toBe('automation')
    expect(roleFromPath('/administracion')).toBe('admin')
    expect(roleFromPath('/analistas')).toBeNull()
    expect(roleFromPath('/cliente')).toBeNull()
  })

  it('orders roles canonically and finds the first home', () => {
    expect(sortRoles(['admin', 'ghost', 'analyst'])).toEqual(['analyst', 'admin'])
    expect(firstRoleHome(['admin', 'automation'])).toBe('/automatizacion')
    expect(firstRoleHome([])).toBeNull()
  })

  it('marks the agents item active on the whole agents flow, panorama only on its exact path', () => {
    expect(isNavItemActive(agents, '/automatizacion/agentes/AGT-1')).toBe(true)
    expect(isNavItemActive(agents, '/automatizacion/propuestas/PRP-1')).toBe(true)
    expect(isNavItemActive(agents, '/automatizacion/activar/CMP-1')).toBe(true)
    expect(isNavItemActive(agents, '/automatizacion/arbol')).toBe(false)
    expect(isNavItemActive(panorama, '/automatizacion')).toBe(true)
    expect(isNavItemActive(panorama, '/automatizacion/arbol')).toBe(false)
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
