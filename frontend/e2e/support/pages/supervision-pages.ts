import { expect, type Locator, type Page } from '@playwright/test'

export type QueueName = 'Cola en español' | 'Cola en portugués'

/** "Equipo y colas" (`/supervision/equipo`). */
export class TeamPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async goto(): Promise<void> {
    await this.page.goto('/supervision/equipo')
    await expect(this.page.getByRole('heading', { level: 1, name: 'Equipo y colas' })).toBeVisible()
  }

  queue(name: QueueName): Locator {
    return this.page.getByRole('region', { name: 'Colas' }).getByRole('region', { name })
  }

  /** A queued case of this customer in that queue (its name links to the case view). */
  queuedCase(queue: QueueName, customerName: string): Locator {
    return this.queue(queue)
      .getByRole('listitem')
      .filter({
        has: this.page.getByRole('link', { name: customerName, exact: true }),
      })
  }

  async openAssignDialog(queue: QueueName, customerName: string): Promise<AssignDialog> {
    await this.queuedCase(queue, customerName)
      .getByRole('button', { name: `Asignar el caso de ${customerName}` })
      .click()
    const dialog = new AssignDialog(this.page, 'Asignar caso')
    await expect(dialog.root).toBeVisible()
    return dialog
  }
}

/** The supervisor's read-only case view (`/supervision/casos/:caseId`). */
export class SupervisorCasePage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async goto(caseId: string, customerName: string): Promise<void> {
    await this.page.goto(`/supervision/casos/${caseId}`)
    await expect(
      this.page.getByRole('heading', {
        level: 1,
        name: `Conversación de ${customerName} (supervisión)`,
      }),
    ).toBeAttached()
    await expect(
      this.page.getByText('Vista de supervisión · solo lectura', { exact: true }),
    ).toBeVisible()
  }

  async openReassignDialog(): Promise<AssignDialog> {
    await this.page.getByRole('button', { name: 'Reasignar', exact: true }).click()
    const dialog = new AssignDialog(this.page, 'Reasignar caso')
    await expect(dialog.root).toBeVisible()
    return dialog
  }
}

/** "Asignar caso" / "Reasignar caso" (rule 3: non-speakers listed but disabled). */
export class AssignDialog {
  readonly root: Locator
  readonly candidates: Locator

  readonly page: Page

  constructor(page: Page, title: 'Asignar caso' | 'Reasignar caso') {
    this.page = page
    this.root = page.getByRole('dialog', { name: title })
    this.candidates = this.root.getByRole('radiogroup', { name: /¿A quién\?/ })
  }

  candidate(name: string): Locator {
    return this.candidates.getByRole('radio', { name, exact: true })
  }

  async choose(name: string, { confirmPaused = false } = {}): Promise<void> {
    await this.candidate(name).check()
    if (confirmPaused) {
      await this.root.getByRole('checkbox', { name: 'Asignar aunque esté en pausa' }).check()
    }
  }

  /**
   * "Asignar a {nombre}" / "Reasignar a {nombre}". Closed for good: `?asignar=` is
   * gone too (a dialog dropped while the overviews refetched used to keep it, and
   * then reopened as "Reasignar caso" once the team listed the case).
   */
  async submit(label: RegExp): Promise<void> {
    await this.root.getByRole('button', { name: label }).click()
    await expect(this.root).toBeHidden()
    await expect(this.page).not.toHaveURL(/[?&]asignar=/)
    await expect(this.page.getByRole('dialog', { name: /^(Asignar|Reasignar) caso$/ })).toHaveCount(
      0,
    )
  }
}
