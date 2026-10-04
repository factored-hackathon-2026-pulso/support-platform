import { expect, type Locator, type Page } from '@playwright/test'
import { escapeRegExp } from '../data'

/** "Correos de desarrollo" (`/dev/mailbox`): the dev mailbox (part 4). */
export class DevMailboxPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async goto(): Promise<void> {
    await this.page.goto('/dev/mailbox')
    await expect(
      this.page.getByRole('heading', { level: 1, name: 'Correos de desarrollo' }),
    ).toBeVisible()
  }

  /** The newest email to `to` with this subject. */
  email(to: string, subject: string): Locator {
    return this.page.getByRole('article', { name: subject }).filter({ hasText: to }).first()
  }

  /** "Abrir enlace" of the newest invitation to `to` (navigates inside the SPA). */
  async openInvitation(to: string): Promise<void> {
    const email = this.email(to, 'Te invitaron a la Plataforma CC de LATAM Bank')
    await expect(email).toBeVisible()
    await email
      .getByRole('link', { name: new RegExp(`^Abrir enlace.*${escapeRegExp(to)}`) })
      .click()
  }
}

/** "Activa tu cuenta" (`/activate?token=`): password, two-step setup, account ready. */
export class ActivationPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async setPassword(password: string): Promise<void> {
    await expect(
      this.page.getByRole('heading', { level: 1, name: 'Activa tu cuenta' }),
    ).toBeVisible()
    const form = this.page.getByRole('form', { name: 'Crear contraseña' })
    await form.getByLabel('Contraseña nueva').fill(password)
    await form.getByLabel('Repite la contraseña').fill(password)
    const rules = form.getByRole('list', { name: 'Requisitos de la contraseña' })
    await expect(rules.getByText(': cumple', { exact: true })).toHaveCount(4)
    await form.getByRole('button', { name: 'Continuar' }).click()
  }

  /** The manual key the two-step setup shows (spaces removed). */
  async manualKey(): Promise<string> {
    await expect(
      this.page.getByRole('heading', { level: 1, name: 'Configura la verificación en dos pasos' }),
    ).toBeVisible()
    await expect(
      this.page.getByRole('img', { name: 'Código QR para tu app de autenticación' }),
    ).toBeVisible()
    const key = this.page.getByLabel('¿No puedes escanear? Escribe esta clave en la app:')
    return ((await key.textContent()) ?? '').replace(/\s+/g, '')
  }

  async enterCode(code: string): Promise<void> {
    const form = this.page.getByRole('form', { name: 'Confirmar el código' })
    await form.getByRole('textbox', { name: 'Dígito 1' }).click()
    await this.page.keyboard.type(code)
    await form.getByRole('button', { name: 'Activar cuenta' }).click()
  }
}
