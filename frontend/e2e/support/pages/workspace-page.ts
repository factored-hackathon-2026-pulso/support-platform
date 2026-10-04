import { expect, type Locator, type Page } from '@playwright/test'
import { startsWithName } from '../data'
import { HomePage, type StatusTileLabel } from './home-page'

export type CloseReasonLabel =
  'Resuelto' | 'El cliente no respondió' | 'Duplicado' | 'Fuera de alcance' | 'Otro'

export type InboxFilter = 'Todos' | 'Por responder' | 'Nuevos' | 'Esperando al cliente' | 'Cerrados'

/** The Inicio tile behind each Casos filter (slice 6: the filters live on Inicio). */
const TILE_OF: Record<Exclude<InboxFilter, 'Todos'>, StatusTileLabel> = {
  'Por responder': 'Por responder',
  Nuevos: 'Nuevos',
  'Esperando al cliente': 'Esperando al cliente',
  Cerrados: 'Cerrados',
}

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

  /**
   * The availability control at the top of the list (slice 6: it is the pause
   * indicator): "En pausa. Volver a disponible" / "Disponible. Pausar casos nuevos".
   */
  availability(state: 'En pausa' | 'Disponible'): Locator {
    return this.listRegion.getByRole('button', { name: new RegExp(`^${state}\\s*\\.`) })
  }

  async becomeAvailable(): Promise<void> {
    await this.availability('En pausa').click()
    await expect(this.availability('Disponible')).toBeVisible()
  }

  /** The removable chip of the filter in the URL ("Quitar filtro Cerrados"). */
  filterChip(label?: Exclude<InboxFilter, 'Todos'>): Locator {
    return this.listRegion.getByRole('button', {
      name: label ? `Quitar filtro ${label}` : /^Quitar filtro /,
    })
  }

  /**
   * Slice 6: the list has no status tiles. A filter is picked on Inicio (its tile
   * opens Casos with `?estado=`); "Todos" removes the chip.
   */
  async showFilter(label: InboxFilter): Promise<void> {
    if (label === 'Todos') {
      await this.filterChip().click()
      await expect(this.filterChip()).toHaveCount(0)
      return
    }
    await this.page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: 'Inicio' })
      .click()
    const home = new HomePage(this.page)
    await home.tile(TILE_OF[label]).click()
    await expect(this.filterChip(label)).toBeVisible()
  }

  /**
   * "Ficha del cliente" (slice 6): the customer's name in the header opens the
   * right panel; returns it.
   */
  async openCustomerFile(customerName: string): Promise<Locator> {
    const trigger = this.conversation(customerName).getByRole('button', {
      name: `Ver ficha de ${customerName}`,
    })
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const panel = this.page.getByRole('complementary', { name: 'Ficha del cliente' })
    await expect(panel).toBeVisible()
    return panel
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

  /** The read-only footer of a closed case (or someone else's): "Solo lectura". */
  readOnlyFooter(customerName: string): Locator {
    return this.conversation(customerName).getByRole('note', { name: 'Solo lectura' })
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
    // Slice 6: the reasons are cards (the native radio is visually hidden): click the card.
    const reasons = dialog.getByRole('radiogroup', { name: /Motivo/ })
    const radio = reasons.getByRole('radio', { name: reason })
    await reasons
      .locator('label')
      .filter({ has: this.page.getByRole('radio', { name: reason }) })
      .click()
    await expect(radio).toBeChecked()
    if (note) await dialog.getByRole('textbox', { name: /Nota interna/ }).fill(note)
    await dialog.getByRole('button', { name: 'Cerrar caso' }).click()
    await expect(dialog).toBeHidden()
  }
}
