import { expect, type Locator, type Page } from '@playwright/test'

export type RoleLabel = 'Analista' | 'Supervisión' | 'Administración'

/** The staff shell: the "Principal" rail, the role switcher and the toasts. */
export class AppShell {
  readonly rail: Locator
  readonly toasts: Locator

  readonly page: Page
  readonly userName: string

  constructor(page: Page, userName: string) {
    this.page = page
    this.userName = userName
    this.rail = page.getByRole('navigation', { name: 'Principal' })
    this.toasts = page.getByRole('region', { name: 'Notificaciones' })
  }

  get roleSwitcherButton(): Locator {
    return this.rail.getByRole('button', { name: `${this.userName}, cambiar de rol` })
  }

  /** Opens the avatar menu and returns its "Cambiar de rol" list. */
  async openRoleSwitcher(): Promise<Locator> {
    const button = this.roleSwitcherButton
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    const list = this.rail.getByRole('list', { name: 'Cambiar de rol' })
    await expect(list).toBeVisible()
    return list
  }

  async closeRoleSwitcher(): Promise<void> {
    const button = this.roleSwitcherButton
    if ((await button.getAttribute('aria-expanded')) === 'true') await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'false')
  }

  /** A toast with this title (toasts are announced in the "Notificaciones" region). */
  toast(title: string | RegExp): Locator {
    return this.toasts.getByText(title)
  }
}
