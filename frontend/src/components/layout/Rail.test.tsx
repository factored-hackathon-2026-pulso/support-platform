import { screen, within } from '@testing-library/react'
import { Users } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { ROLES, type RoleDefinition } from '@/app/roles'
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

/** Supervision with the slice 3 queue item, to exercise the indicator plumbing. */
const supervisionWithQueue: RoleDefinition = {
  ...ROLES.supervisor,
  nav: [
    ...ROLES.supervisor.nav,
    { to: '/supervision/cola', label: 'Cola', icon: Users, indicator: 'queuedCases' },
  ],
}

describe('Rail per role', () => {
  it('analyst: only Casos', async () => {
    const rail = await railFor('/analista?caso=CASE-1', 'Casos')
    expect(destinations(rail)).toEqual(['Casos'])
    expect(rail.getByRole('link', { name: 'Casos' })).toHaveAttribute('aria-current', 'page')
  })

  it('supervisor: team and audit', async () => {
    const rail = await railFor('/supervision/auditoria', 'Auditoría')
    expect(destinations(rail)).toEqual(['Equipo y colas', 'Auditoría'])
    expect(rail.getByRole('link', { name: 'Auditoría' })).toHaveAttribute('aria-current', 'page')
  })

  it('admin: users and roles', async () => {
    const rail = await railFor('/administracion/usuarios', 'Usuarios y roles')
    expect(destinations(rail)).toEqual(['Usuarios y roles'])
    expect(rail.getByRole('link', { name: 'Usuarios y roles' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

describe('Rail indicators', () => {
  it('shows live counts in the badge and in the accessible name', () => {
    renderWithProviders(
      <Rail role={supervisionWithQueue} indicators={{ queuedCases: { count: 4 } }} />,
      { route: '/supervision/equipo', staff: allRolesStaff },
    )
    const link = screen.getByRole('link', { name: 'Cola, 4 pendientes' })
    expect(within(link).getByText('4')).toBeInTheDocument()
  })

  it('uses the singular, the dot label, and nothing for a zero count', () => {
    const { unmount } = renderWithProviders(
      <Rail role={supervisionWithQueue} indicators={{ queuedCases: { count: 1 } }} />,
      { route: '/', staff: allRolesStaff },
    )
    expect(screen.getByRole('link', { name: 'Cola, 1 pendiente' })).toBeInTheDocument()
    unmount()
    const dot = renderWithProviders(
      <Rail role={supervisionWithQueue} indicators={{ queuedCases: { dot: true } }} />,
      { route: '/', staff: allRolesStaff },
    )
    expect(screen.getByRole('link', { name: 'Cola, con novedades' })).toBeInTheDocument()
    dot.unmount()
    renderWithProviders(
      <Rail role={supervisionWithQueue} indicators={{ queuedCases: { count: 0 } }} />,
      { route: '/', staff: allRolesStaff },
    )
    expect(screen.getByRole('link', { name: 'Cola' })).toBeInTheDocument()
  })
})
