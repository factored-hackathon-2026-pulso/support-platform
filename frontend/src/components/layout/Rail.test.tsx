import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ROLES } from '@/app/roles'
import { allRolesStaff } from '@/test/fixtures'
import { renderRoute, renderWithProviders } from '@/test/render'
import { Rail } from './Rail'

async function railFor(path: string, heading: string) {
  renderRoute(path, { staff: allRolesStaff })
  await screen.findByRole('heading', { level: 1, name: heading })
  const nav = screen.getByRole('navigation', { name: 'Principal' })
  return within(nav)
}

function destinations(rail: Awaited<ReturnType<typeof railFor>>) {
  return rail.getAllByRole('link').map((link) => link.getAttribute('aria-label'))
}

describe('Rail per role', () => {
  it('analyst: only Casos', async () => {
    const rail = await railFor('/analista?caso=CASE-1', 'Casos')
    expect(destinations(rail)).toEqual(['Casos'])
    expect(rail.getByRole('link', { name: 'Casos' })).toHaveAttribute('aria-current', 'page')
  })

  it('supervisor: team, approvals, audit (no made-up pending count)', async () => {
    const rail = await railFor('/supervision/aprobaciones', 'Por aprobar')
    expect(destinations(rail)).toEqual(['Equipo y colas', 'Por aprobar', 'Auditoría'])
    expect(rail.getByRole('link', { name: 'Por aprobar' })).toHaveAttribute('aria-current', 'page')
  })

  it('automation: panorama, tree, agents (active on the agents flow)', async () => {
    const rail = await railFor(
      '/automatizacion/propuestas/PRP-7',
      '¿Habría resuelto bien los casos de tu equipo?',
    )
    expect(destinations(rail)).toEqual(['Panorama', 'Árbol de decisión', 'Agentes'])
    expect(rail.getByRole('link', { name: 'Agentes' })).toHaveAttribute('aria-current', 'page')
    expect(rail.getByRole('link', { name: 'Panorama' })).not.toHaveAttribute('aria-current')
  })

  it('admin: the four administration sections', async () => {
    const rail = await railFor('/administracion/retencion', 'Retención de datos')
    expect(destinations(rail)).toEqual([
      'Usuarios y roles',
      'Herramientas y permisos',
      'Políticas y reglas',
      'Retención de datos',
    ])
    expect(rail.getByRole('link', { name: 'Retención de datos' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

describe('Rail indicators', () => {
  it('shows live counts and dots in the badge and in the accessible name', () => {
    renderWithProviders(
      <Rail
        role={ROLES.supervisor}
        indicators={{ pendingApprovals: { count: 4 }, automationNews: { dot: true } }}
      />,
      { route: '/supervision/equipo', staff: allRolesStaff },
    )
    const link = screen.getByRole('link', { name: 'Por aprobar, 4 pendientes' })
    expect(within(link).getByText('4')).toBeInTheDocument()
  })

  it('uses the singular, the dot label, and nothing for a zero count', () => {
    renderWithProviders(
      <>
        <Rail role={ROLES.admin} indicators={{ pendingAdminChanges: { count: 1 } }} />
        <Rail role={ROLES.automation} indicators={{ automationNews: { dot: true } }} />
        <Rail role={ROLES.supervisor} indicators={{ pendingApprovals: { count: 0 } }} />
      </>,
      { route: '/', staff: allRolesStaff },
    )
    expect(
      screen.getByRole('link', { name: 'Herramientas y permisos, 1 pendiente' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Panorama, con novedades' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Por aprobar' })).toBeInTheDocument()
  })
})
