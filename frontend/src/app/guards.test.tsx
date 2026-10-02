import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { sessionToken } from '@/lib/session-token'
import { analystStaff, automationAdminStaff, supervisorStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'

describe('route guards', () => {
  it('sends anonymous users to /login and remembers where they were going', async () => {
    const { router } = renderRoute('/supervision/auditoria?filtro=abonos')
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.state).toEqual({ from: '/supervision/auditoria?filtro=abonos' })
  })

  it('redirects a role section the user does not hold to their first role home', async () => {
    const { router } = renderRoute('/administracion/usuarios', { staff: analystStaff })
    expect(await screen.findByRole('heading', { level: 1, name: 'Casos' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/analista')
  })

  it('opens the sections of every role the user holds', async () => {
    const { router } = renderRoute('/administracion/reglas', { staff: automationAdminStaff })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Políticas y reglas' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/administracion/reglas')
  })

  it('sends "/" to the home of the first role', async () => {
    const { router } = renderRoute('/', { staff: supervisorStaff })
    // supervisorStaff holds supervisor + analyst: analyst comes first in canonical order.
    expect(await screen.findByRole('heading', { level: 1, name: 'Casos' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/analista')
  })

  it('redirects role roots to their first section', async () => {
    const { router } = renderRoute('/supervision', { staff: supervisorStaff })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Equipo y colas' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/supervision/equipo')
  })

  it('keeps signed-in users out of the login screens', async () => {
    const { router } = renderRoute('/login', { staff: automationAdminStaff })
    expect(await screen.findByRole('heading', { level: 1, name: 'Panorama' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/automatizacion')
  })

  it('offers a retry instead of the login when the session cannot be restored (API down)', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 503, code: 'unavailable', title: 'x' }), {
        status: 503,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    )
    const { user, router } = renderRoute('/supervision/equipo', { token: 'tkn-stored' })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'No pudimos cargar tu sesión' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/supervision/equipo')
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
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Equipo y colas' }),
    ).toBeInTheDocument()
    expect(document.title).toBe('Equipo y colas · LATAM Bank Soporte')
  })

  it('explains when the account has no role', async () => {
    renderRoute('/analista', { staff: { ...analystStaff, roles: [] } })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tu cuenta no tiene un rol asignado' }),
    ).toBeInTheDocument()
  })

  it('shows the not found page inside the shell', async () => {
    renderRoute('/automatizacion/no-existe', { staff: automationAdminStaff })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Página no encontrada' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument()
  })

  it('renders the customer simulator without the staff shell or a session', async () => {
    renderRoute('/cliente')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Simulador de cliente' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument()
  })
})
