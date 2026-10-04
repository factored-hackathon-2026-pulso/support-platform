import { expect, type Locator, type Page } from '@playwright/test'
import { DEMO_PASSWORD, DEV_MFA_CODE } from '../data'
import { totpCode } from '../totp'

/** `/login` → `/login/verificacion` (MFA) → the first role home; `/login/bloqueada`. */
export class LoginPage {
  readonly email: Locator
  readonly password: Locator
  readonly continue: Locator
  readonly failure: Locator

  readonly page: Page

  constructor(page: Page) {
    this.page = page
    const form = page.getByRole('form', { name: 'Entrar con correo' })
    this.email = form.getByRole('textbox', { name: 'Correo' })
    this.password = form.getByRole('textbox', { name: 'Contraseña' })
    this.continue = form.getByRole('button', { name: 'Continuar', exact: true })
    this.failure = form.getByRole('alert')
  }

  async goto(): Promise<void> {
    await this.page.goto('/login')
    await expect(this.page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible()
  }

  /** Password step only (lands on MFA, or shows an error, or the lockout screen). */
  async submitPassword(email: string, password: string): Promise<void> {
    await this.email.fill(email)
    await this.password.fill(password)
    await this.continue.click()
  }

  async enterMfa(code: string = DEV_MFA_CODE): Promise<void> {
    const form = this.page.getByRole('form', { name: 'Segundo factor' })
    await expect(
      this.page.getByRole('heading', { level: 1, name: 'Confirma que eres tú' }),
    ).toBeVisible()
    await form.getByRole('textbox', { name: 'Dígito 1' }).click()
    await this.page.keyboard.type(code)
    await form.getByRole('button', { name: 'Entrar', exact: true }).click()
  }

  /**
   * Full sign-in; waits until the app leaves `/login`. Part 4: a person who activated
   * an invitation types the code of her authenticator (computed from `totpSecret`);
   * a seeded account types the development code.
   */
  async signIn(
    email: string,
    password: string = DEMO_PASSWORD,
    totpSecret?: string,
  ): Promise<void> {
    await this.goto()
    await this.submitPassword(email, password)
    await this.enterMfa(totpSecret ? totpCode(totpSecret) : DEV_MFA_CODE)
    await expect(this.page).not.toHaveURL(/\/login/)
  }
}
