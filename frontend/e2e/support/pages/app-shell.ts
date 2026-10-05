import { expect, type Locator, type Page } from '@playwright/test'

export type RoleLabel = 'Analista' | 'Supervisión' | 'Administración'

/** The staff shell: the "Principal" rail, the role switcher, the bell and the toasts. */
export class AppShell {
  readonly rail: Locator
  readonly toasts: Locator
  /** The bell of the rail (slice 10): "Notificaciones" or "Notificaciones, 3 sin leer". */
  readonly bell: Locator
  /** Its panel, while open. */
  readonly notifications: Locator

  readonly page: Page
  readonly userName: string

  constructor(page: Page, userName: string) {
    this.page = page
    this.userName = userName
    this.rail = page.getByRole('navigation', { name: 'Principal' })
    this.toasts = page.getByRole('region', { name: 'Avisos' })
    this.bell = this.rail.getByRole('button', { name: /^Notificaciones/ })
    this.notifications = page.getByRole('region', { name: 'Notificaciones' })
  }

  /** Unread notifications, read from the bell's accessible name. */
  async unreadCount(): Promise<number> {
    const name = (await this.bell.getAttribute('aria-label')) ?? ''
    const match = /, (\d+) sin leer$/.exec(name)
    return match ? Number(match[1]) : 0
  }

  /** Opens the bell's panel and returns it. */
  async openNotifications(): Promise<Locator> {
    if ((await this.bell.getAttribute('aria-expanded')) !== 'true') await this.bell.click()
    await expect(this.notifications).toBeVisible()
    return this.notifications
  }

  /** A row of the open panel with this title (and, optionally, this line). */
  notification(title: string | RegExp, detail?: string): Locator {
    let row = this.notifications.getByRole('listitem').filter({ hasText: title })
    if (detail) row = row.filter({ hasText: detail })
    return row
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

  /**
   * Slice 23: picks the platform language in the avatar menu by its own name ("Español",
   * "Português"). The menu stays open and follows the new language.
   */
  async chooseLanguage(name: 'Español' | 'Português'): Promise<void> {
    const button = this.rail.getByRole('button', { name: new RegExp(`^${this.userName}, `) })
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
    const option = this.rail.getByRole('button', { name, exact: true })
    await option.click()
    await expect(option).toHaveAttribute('aria-pressed', 'true')
  }

  /** A toast with this title (toasts are announced in the "Avisos" region). */
  toast(title: string | RegExp): Locator {
    return this.toasts.getByText(title)
  }
}
