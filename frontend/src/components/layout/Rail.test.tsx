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
  it('analyst: Inicio, then Casos', async () => {
    const rail = await railFor('/analyst/cases?case=CASE-1', 'Casos')
    expect(destinations(rail)).toEqual(['Inicio', 'Casos'])
    expect(rail.getByRole('link', { name: 'Casos' })).toHaveAttribute('aria-current', 'page')
    expect(rail.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current')
  })

  it('supervisor: queues, team, escalations and audit', async () => {
    const rail = await railFor('/supervision/audit', 'Auditoría')
    expect(destinations(rail)).toEqual(['Colas', 'Equipo', 'Escalados', 'Auditoría'])
    expect(rail.getByRole('link', { name: 'Auditoría' })).toHaveAttribute('aria-current', 'page')
  })

  it('supervisor with AI on: "Automatización" before audit (slice 22)', () => {
    renderWithProviders(<Rail role={ROLES.supervisor} aiEnabled />, {
      route: '/supervision/team',
      staff: allRolesStaff,
    })
    const rail = within(screen.getByRole('navigation', { name: 'Principal' }))
    expect(destinations(rail)).toEqual([
      'Colas',
      'Equipo',
      'Escalados',
      'Automatización',
      'Auditoría',
    ])
  })

  it('admin: users and roles, teams, audit and the platform settings', async () => {
    const rail = await railFor('/admin/users', 'Usuarios y roles')
    expect(destinations(rail)).toEqual(['Usuarios y roles', 'Equipos', 'Auditoría', 'Plataforma'])
    expect(rail.getByRole('link', { name: 'Usuarios y roles' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

describe('Rail presence dot', () => {
  it('labels the analyst availability next to the avatar', () => {
    const { unmount } = renderWithProviders(
      <Rail role={ROLES.analyst} presence={{ tone: 'warn', label: 'Estado: En pausa' }} />,
      { route: '/analyst/home', staff: allRolesStaff },
    )
    const nav = within(screen.getByRole('navigation', { name: 'Principal' }))
    expect(nav.getByText('Estado: En pausa')).toBeInTheDocument()
    // The switcher keeps its name.
    expect(nav.getByRole('button', { name: /, cambiar de rol$/ })).toBeInTheDocument()
    unmount()
    renderWithProviders(<Rail role={ROLES.supervisor} />, {
      route: '/supervision/team',
      staff: allRolesStaff,
    })
    expect(screen.queryByText(/^Estado:/)).not.toBeInTheDocument()
  })
})

describe('Rail indicators', () => {
  it('shows the Por responder count on Casos', () => {
    renderWithProviders(<Rail role={ROLES.analyst} indicators={{ toReplyCases: { count: 2 } }} />, {
      route: '/analyst/home',
      staff: allRolesStaff,
    })
    expect(screen.getByRole('link', { name: 'Casos, 2 pendientes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows live counts in the badge and in the accessible name', () => {
    renderWithProviders(
      <Rail role={supervisionWithQueue} indicators={{ queuedCases: { count: 4 } }} />,
      { route: '/supervision/team', staff: allRolesStaff },
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

describe('Rail notifications slot (slice 10)', () => {
  it('puts the bell above the avatar, for every role', () => {
    renderWithProviders(
      <Rail role={ROLES.admin} notifications={<button type="button">Notificaciones</button>} />,
      { route: '/admin/users', staff: allRolesStaff },
    )
    const nav = within(screen.getByRole('navigation', { name: 'Principal' }))
    const bell = nav.getByRole('button', { name: 'Notificaciones' })
    const avatar = nav.getByRole('button', { name: /, cambiar de rol$/ })
    expect(bell.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the staff shell composes the bell into the rail of every role', async () => {
    for (const [path, heading] of [
      ['/analyst/cases?case=CASE-1', 'Casos'],
      ['/supervision/audit', 'Auditoría'],
      ['/admin/users', 'Usuarios y roles'],
    ] as const) {
      const { unmount } = renderRoute(path, { staff: allRolesStaff })
      await screen.findByRole('heading', { level: 1, name: heading })
      const nav = within(screen.getByRole('navigation', { name: 'Principal' }))
      expect(nav.getByRole('button', { name: /^Notificaciones/ })).toBeInTheDocument()
      unmount()
    }
  })
})
