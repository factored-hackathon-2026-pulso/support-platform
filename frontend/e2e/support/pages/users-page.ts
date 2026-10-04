import { expect, type Locator, type Page } from '@playwright/test'
import type { Language } from '../data'
import type { RoleLabel } from './app-shell'

const LANGUAGE_LABEL: Record<Language, string> = { es: 'Español', pt: 'Portugués' }

/** "Usuarios y roles" (`/admin/users`): table + the "Persona seleccionada" aside. */
export class UsersPage {
  readonly table: Locator
  readonly aside: Locator

  readonly page: Page

  constructor(page: Page) {
    this.page = page
    this.table = page.getByRole('table', { name: 'Personas' })
    this.aside = page.getByRole('complementary', { name: 'Persona seleccionada' })
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/users')
    await expect(
      this.page.getByRole('heading', { level: 1, name: 'Usuarios y roles' }),
    ).toBeVisible()
  }

  /** The row of this person (the "Filtros" in use must include her). */
  row(name: string): Locator {
    return this.table.getByRole('row').filter({
      has: this.page.getByRole('button', { name, exact: true }),
    })
  }

  async search(text: string): Promise<void> {
    await this.page.getByRole('searchbox', { name: 'Buscar persona' }).fill(text)
  }

  /** Selects the person: her account form opens in the aside. */
  async select(name: string): Promise<Locator> {
    await this.search(name)
    await this.row(name).getByRole('button', { name, exact: true }).click()
    const form = this.accountForm(name)
    await expect(form).toBeVisible()
    return form
  }

  accountForm(name: string): Locator {
    return this.aside.getByRole('form', { name: `Cuenta de ${name}` })
  }

  roleCheckbox(name: string, role: RoleLabel): Locator {
    return this.accountForm(name)
      .getByRole('group', { name: 'Roles' })
      .getByRole('checkbox', { name: new RegExp(`^${role}\\b`) })
  }

  /**
   * "Nuevo usuario" → fill the form → "Enviar invitación" → the "Invitación enviada"
   * dialog (part 4: nobody sees a password; she gets a link by email).
   */
  async invitePerson(input: {
    name: string
    email: string
    roles: RoleLabel[]
    languages: Language[]
    team: string
  }): Promise<void> {
    await this.page.getByRole('button', { name: 'Nuevo usuario' }).click()
    const dialog = this.page.getByRole('dialog', { name: 'Nuevo usuario' })
    await expect(dialog).toBeVisible()
    const form = dialog.getByRole('form', { name: 'Nuevo usuario' })
    await form.getByRole('textbox', { name: 'Nombre completo' }).fill(input.name)
    await form.getByRole('textbox', { name: 'Correo' }).fill(input.email)
    for (const role of input.roles) {
      await form
        .getByRole('group', { name: 'Roles' })
        .getByRole('checkbox', { name: new RegExp(`^${role}\\b`) })
        .check()
    }
    for (const language of input.languages) {
      // A pill toggle: the native checkbox is visually hidden inside the pill (keyboard works).
      const pill = form
        .getByRole('group', { name: 'Idiomas' })
        .getByRole('checkbox', { name: LANGUAGE_LABEL[language], exact: true })
      await pill.focus()
      if (!(await pill.isChecked())) await pill.press('Space')
      await expect(pill).toBeChecked()
    }
    await form.getByRole('combobox', { name: 'Equipo' }).selectOption({ label: input.team })
    await dialog.getByRole('button', { name: 'Enviar invitación' }).click()

    const sent = this.page.getByRole('dialog', { name: 'Invitación enviada' })
    await expect(sent).toBeVisible()
    await expect(sent).toContainText(
      `Invitación enviada a ${input.email}. El enlace vence en 48 horas.`,
    )
    await sent.getByRole('button', { name: 'Listo' }).click()
    await expect(sent).toBeHidden()
  }
}
