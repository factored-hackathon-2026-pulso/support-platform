import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { supervisorAdminStaff, supervisorStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'

describe('RoleSwitcher', () => {
  it('lists only the roles the user holds, marking the current one', async () => {
    const { user } = renderRoute('/admin/users', { staff: supervisorAdminStaff })
    await screen.findByRole('heading', { level: 1, name: 'Usuarios y roles' })

    const trigger = screen.getByRole('button', { name: 'Carolina Peña Ruiz, cambiar de rol' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const list = screen.getByRole('list', { name: 'Cambiar de rol' })
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Supervisión', 'Administración'])
    expect(within(list).getByRole('link', { name: 'Administración' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(within(list).queryByRole('link', { name: 'Analista de casos' })).not.toBeInTheDocument()
  })

  it('switches role and lands on its home', async () => {
    const { user, router } = renderRoute('/analyst/cases', { staff: supervisorStaff })
    await screen.findByRole('heading', { level: 1, name: 'Casos' })
    await user.click(screen.getByRole('button', { name: /cambiar de rol/ }))
    await user.click(screen.getByRole('link', { name: 'Supervisión' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Colas' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/supervision/queues')
    expect(screen.queryByRole('list', { name: 'Cambiar de rol' })).not.toBeInTheDocument()
  })

  it('closes with Escape and returns focus to the avatar', async () => {
    const { user } = renderRoute('/analyst/cases', { staff: supervisorStaff })
    await screen.findByRole('heading', { level: 1, name: 'Casos' })
    const trigger = screen.getByRole('button', { name: /cambiar de rol/ })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('list', { name: 'Cambiar de rol' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('signs out back to the login', async () => {
    const { user, router } = renderRoute('/analyst/cases', { staff: supervisorStaff })
    await screen.findByRole('heading', { level: 1, name: 'Casos' })
    await user.click(screen.getByRole('button', { name: /cambiar de rol/ }))
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})
