import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { sessionToken } from '@/lib/session-token'
import { adminStaff, analystStaff, supervisorAdminStaff, supervisorStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'

/** The analyst home "Inicio" greets by the time of day (slice 6). */
const GREETING = /^(Buenos días|Buenas tardes|Buenas noches), /

describe('route guards', () => {
  it('sends anonymous users to /login and remembers where they were going', async () => {
    const { router } = renderRoute('/supervision/audit?filtro=cierres')
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.state).toEqual({ from: '/supervision/audit?filtro=cierres' })
  })

  it('redirects a role section the user does not hold to their first role home', async () => {
    const { router } = renderRoute('/admin/users', { staff: analystStaff })
    expect(await screen.findByRole('heading', { level: 1, name: GREETING })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/analyst/home')
  })

  it('opens the sections of every role the user holds', async () => {
    const { router } = renderRoute('/admin/users', { staff: supervisorAdminStaff })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Usuarios y roles' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/users')
  })

  it('sends "/" to the home of the first role', async () => {
    const { router } = renderRoute('/', { staff: supervisorStaff })
    // supervisorStaff holds supervisor + analyst: analyst comes first in canonical order.
    expect(await screen.findByRole('heading', { level: 1, name: GREETING })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/analyst/home')
  })

  it('redirects role roots to their first section', async () => {
    const { router } = renderRoute('/supervision', { staff: supervisorStaff })
    // Slice 9: supervision lands on "Colas".
    expect(await screen.findByRole('heading', { level: 1, name: 'Colas' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/supervision/queues')
  })

  it('keeps signed-in users out of the login screens', async () => {
    const { router } = renderRoute('/login', { staff: adminStaff })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Usuarios y roles' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/users')
  })

  it('offers a retry instead of the login when the session cannot be restored (API down)', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 503, code: 'unavailable', title: 'x' }), {
        status: 503,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    )
    const { user, router } = renderRoute('/supervision/team', { token: 'tkn-stored' })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'No pudimos cargar tu sesión' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/supervision/team')
    expect(sessionToken.get()).toBe('tkn-stored')

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          staff: supervisorStaff,
          session: { id: 'SES-1', expiresAt: '2026-10-02T23:00:00Z' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Equipo' })).toBeInTheDocument()
    expect(document.title).toBe('Equipo · LATAM Bank Soporte')
  })

  it('explains when the account has no role', async () => {
    renderRoute('/analyst/cases', { staff: { ...analystStaff, roles: [] } })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tu cuenta no tiene un rol asignado' }),
    ).toBeInTheDocument()
  })

  it('shows the not found page inside the shell', async () => {
    renderRoute('/admin/rules', { staff: adminStaff })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Página no encontrada' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument()
  })

  it.each(['/admin/tools', '/admin/retention'])(
    'keeps the removed admin screen %s as a not found page',
    async (path) => {
      renderRoute(path, { staff: adminStaff })
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Página no encontrada' }),
      ).toBeInTheDocument()
    },
  )

  it('opens the new admin screens for an admin only', async () => {
    const { unmount } = renderRoute('/admin/teams', { staff: adminStaff })
    expect(await screen.findByRole('heading', { level: 1, name: 'Equipos' })).toBeInTheDocument()
    unmount()
    const { router } = renderRoute('/admin/audit', { staff: supervisorStaff })
    expect(await screen.findByRole('heading', { level: 1, name: GREETING })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/analyst/home')
  })

  it('renders the customer simulator without the staff shell or a session', async () => {
    renderRoute('/customer')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Simulador de cliente' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument()
  })
})

describe('the shell in Brazilian Portuguese (slice 23)', () => {
  it('names the session screens, the rail and the not found page in Portuguese', async () => {
    renderRoute('/admin/rules', { staff: adminStaff, locale: 'pt-BR' })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Este endereço não existe')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir para administração' })).toBeInTheDocument()
    const rail = screen.getByRole('navigation', { name: 'Principal' })
    expect(
      [...rail.querySelectorAll('a[aria-label]')].map((link) => link.getAttribute('aria-label')),
    ).toEqual(['Usuários e perfis', 'Equipes', 'Auditoria', 'Plataforma'])
  })

  it('explains a missing role in Portuguese', async () => {
    renderRoute('/analyst/cases', { staff: { ...analystStaff, roles: [] }, locale: 'pt-BR' })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Sua conta não tem um perfil atribuído',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()
  })
})
