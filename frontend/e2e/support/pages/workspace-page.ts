import { expect, type Locator, type Page } from '@playwright/test'
import { escapeRegExp, startsWithName } from '../data'

export type CloseReasonLabel =
  'Resuelto' | 'El cliente no respondió' | 'Duplicado' | 'Fuera de alcance' | 'Otro'

export type InboxFilter = 'Todos' | 'Por responder' | 'Nuevos' | 'Esperando al cliente' | 'Cerrados'

/** The analyst Workspace (`/analista`): "Casos" list + the conversation. */
export class WorkspacePage {
  readonly listRegion: Locator
  readonly caseList: Locator
  readonly main: Locator

  readonly page: Page

  constructor(page: Page) {
    this.page = page
    this.listRegion = page.getByRole('region', { name: 'Casos abiertos' })
    this.caseList = this.listRegion.getByRole('list', { name: 'Casos' })
    this.main = page.getByRole('main')
  }

  async goto(): Promise<void> {
    await this.page.goto('/analista')
    await expect(this.listRegion.getByRole('heading', { level: 1, name: 'Casos' })).toBeVisible()
  }

  /** The "En pausa" / "Disponible" pill next to the title. */
  availability(state: 'En pausa' | 'Disponible'): Locator {
    return this.listRegion.getByRole('button', { name: new RegExp(`^${state}\\s*\\.`) })
  }

  async becomeAvailable(): Promise<void> {
    await this.availability('En pausa').click()
    await expect(this.availability('Disponible')).toBeVisible()
  }

  filter(label: InboxFilter): Locator {
    return this.listRegion
      .getByRole('radiogroup', { name: 'Filtrar casos' })
      .getByRole('radio', { name: new RegExp(`^\\d+ ${escapeRegExp(label)}$`) })
  }

  /** The tiles are native radios drawn under their count: select one with the keyboard. */
  async showFilter(label: InboxFilter): Promise<void> {
    const radio = this.filter(label)
    await radio.focus()
    await radio.press('Space')
    await expect(radio).toBeChecked()
  }

  /** A case card of the list (its accessible name starts with the customer name). */
  caseCard(customerName: string): Locator {
    return this.caseList.getByRole('button', { name: startsWithName(customerName) })
  }

  /** The open conversation with this customer. */
  conversation(customerName: string): Locator {
    return this.main.getByRole('region', { name: `Conversación con ${customerName}` })
  }

  /** The transcript items of the open conversation, in order. */
  messages(customerName: string): Locator {
    return this.conversation(customerName)
      .getByRole('log', { name: 'Conversación del caso' })
      .getByRole('list', { name: 'Mensajes' })
      .getByRole('listitem')
  }

  async openCase(customerName: string): Promise<Locator> {
    await this.caseCard(customerName).click()
    const conversation = this.conversation(customerName)
    await expect(conversation.getByRole('heading', { level: 2, name: customerName })).toBeVisible()
    return conversation
  }

  composer(customerName: string): Locator {
    return this.conversation(customerName).getByRole('textbox', { name: 'Escribe al cliente' })
  }

  async reply(customerName: string, text: string): Promise<void> {
    await this.composer(customerName).fill(text)
    await this.conversation(customerName)
      .getByRole('button', { name: 'Enviar', exact: true })
      .click()
    await expect(this.messages(customerName).filter({ hasText: text })).toHaveCount(1)
    await expect(this.composer(customerName)).toHaveValue('')
  }

  async closeCase(customerName: string, reason: CloseReasonLabel, note?: string): Promise<void> {
    await this.conversation(customerName).getByRole('button', { name: 'Cerrar caso' }).click()
    const dialog = this.page.getByRole('dialog', { name: 'Cerrar caso' })
    await expect(dialog).toBeVisible()
    await dialog
      .getByRole('radiogroup', { name: /Motivo/ })
      .getByRole('radio', { name: reason })
      .check()
    if (note) await dialog.getByRole('textbox', { name: /Nota interna/ }).fill(note)
    await dialog.getByRole('button', { name: 'Cerrar caso' }).click()
    await expect(dialog).toBeHidden()
  }
}
