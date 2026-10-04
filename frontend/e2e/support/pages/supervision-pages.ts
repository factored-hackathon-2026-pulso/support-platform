import { expect, type Locator, type Page } from '@playwright/test'
import { escapeRegExp } from '../data'

export type QueueLanguage = 'Español' | 'Portugués'

/** "Colas" (`/supervision/queues`): every open case of a language. */
export class QueuesPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async goto(language: QueueLanguage = 'Español'): Promise<void> {
    await this.page.goto(`/supervision/queues${language === 'Portugués' ? '?language=pt' : ''}`)
    await expect(this.page.getByRole('heading', { level: 1, name: 'Colas' })).toBeVisible()
  }

  table(language: QueueLanguage): Locator {
    return this.page.getByRole('table', { name: `Casos abiertos en ${language.toLowerCase()}` })
  }

  /** The row of this customer's open case (its name links to the case view). */
  caseRow(language: QueueLanguage, customerName: string): Locator {
    return this.table(language)
      .getByRole('row')
      .filter({ has: this.page.getByRole('link', { name: customerName, exact: true }) })
  }
}

/** "Escalados" (`/supervision/escalations`). */
export class EscalationsPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async goto(): Promise<void> {
    await this.page.goto('/supervision/escalations')
    await expect(this.page.getByRole('heading', { level: 1, name: 'Escalados' })).toBeVisible()
  }

  /** The row of an escalation of this customer's case. */
  row(customerName: string): Locator {
    return this.page
      .getByRole('region', { name: 'Escalamientos' })
      .getByRole('button', { name: new RegExp(escapeRegExp(customerName)) })
  }

  panel(customerName: string): Locator {
    return this.page.getByRole('complementary', { name: customerName })
  }

  async answer(customerName: string, note: string): Promise<void> {
    await this.row(customerName).click()
    const panel = this.panel(customerName)
    await panel.getByRole('button', { name: 'Responder', exact: true }).click()
    await panel.getByRole('textbox', { name: /^Tu respuesta para/ }).fill(note)
    await panel.getByRole('button', { name: 'Enviar respuesta' }).click()
    await expect(this.page.getByText(/^Le llegó tu respuesta a /)).toBeVisible()
  }
}

/** The supervisor's read-only case view (`/supervision/cases/:caseId`). */
export class SupervisorCasePage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async goto(caseId: string, customerName: string): Promise<void> {
    await this.page.goto(`/supervision/cases/${caseId}`)
    await expect(
      this.page.getByRole('heading', {
        level: 1,
        name: `Conversación de ${customerName} (supervisión)`,
      }),
    ).toBeAttached()
    await expect(this.page.getByText('Solo lectura', { exact: true })).toBeVisible()
  }

  async openReassignDialog(): Promise<ReassignDialog> {
    await this.page.getByRole('button', { name: 'Reasignar', exact: true }).click()
    const dialog = new ReassignDialog(this.page)
    await expect(dialog.root).toBeVisible()
    return dialog
  }
}

/**
 * "Reasignar caso": only people who speak the case language are listed (rule 3); three
 * suggestions, a search for the rest, paused people only on demand.
 */
export class ReassignDialog {
  readonly root: Locator
  readonly people: Locator
  readonly page: Page

  constructor(page: Page) {
    this.page = page
    this.root = page.getByRole('dialog', { name: 'Reasignar caso' })
    this.people = this.root.getByRole('radiogroup', { name: 'Personas' })
  }

  candidate(name: string): Locator {
    return this.people.getByRole('radio', { name: this.nameOf(name) })
  }

  private nameOf(name: string): RegExp {
    return new RegExp(`^${escapeRegExp(name)}`)
  }

  async search(text: string): Promise<void> {
    await this.root.getByRole('searchbox', { name: 'Buscar a alguien del equipo' }).fill(text)
  }

  async includeAway(): Promise<void> {
    await this.root
      .getByRole('checkbox', { name: 'Incluir a quienes están en pausa o desconectados' })
      .check()
  }

  async choose(name: string, { confirmPaused = false } = {}): Promise<void> {
    // The native radio is visually hidden inside its row: pick the row (its label).
    await this.people
      .locator('label')
      .filter({ has: this.page.getByRole('radio', { name: this.nameOf(name) }) })
      .click()
    await expect(this.candidate(name)).toBeChecked()
    if (confirmPaused) {
      await this.root.getByRole('checkbox', { name: 'Pasarlo aunque esté en pausa' }).check()
    }
  }

  /** "Reasignar a {nombre}"; closed for good (`?reassign=` gone too). */
  async submit(label: RegExp): Promise<void> {
    await this.root.getByRole('button', { name: label }).click()
    await expect(this.root).toBeHidden()
    await expect(this.page).not.toHaveURL(/[?&]reassign=/)
  }
}
