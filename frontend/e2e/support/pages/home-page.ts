import { expect, type Locator, type Page } from '@playwright/test'
import { escapeRegExp } from '../data'

export type StatusTileLabel = 'Por responder' | 'Nuevos' | 'Esperando al cliente' | 'Cerrados'

/** The analyst home "Inicio" (`/analyst/home`, slice 6): where an analyst lands. */
export class HomePage {
  readonly main: Locator
  readonly availability: Locator
  readonly tiles: Locator
  readonly firstCases: Locator
  readonly feed: Locator
  readonly team: Locator

  readonly page: Page

  constructor(page: Page) {
    this.page = page
    this.main = page.getByRole('main')
    this.availability = page.getByRole('region', { name: 'Tu disponibilidad' })
    this.tiles = page.getByRole('navigation', { name: 'Tus casos por estado' })
    this.firstCases = page.getByRole('region', { name: 'Lo primero' })
    this.feed = page.getByRole('region', { name: 'Mientras no estabas' })
    this.team = page.getByRole('region', { name: 'Tu equipo ahora' })
  }

  /** The greeting h1 ("Buenos días, Inés"). */
  greeting(firstName: string): Locator {
    return this.page.getByRole('heading', {
      level: 1,
      name: new RegExp(`^(Buenos días|Buenas tardes|Buenas noches), ${escapeRegExp(firstName)}$`),
    })
  }

  async goto(): Promise<void> {
    await this.page.goto('/analyst/home')
    await expect(this.availability).toBeVisible()
  }

  /** "Empezar a atender": she becomes available (the queue of her languages drains to her). */
  async startWorking(): Promise<void> {
    await this.availability.getByRole('button', { name: 'Empezar a atender' }).click()
    await expect(this.availability.getByText('Estás disponible')).toBeVisible()
  }

  /** A row of "Lo primero" (its customer name is the first text of the row). */
  firstCase(customerName: string): Locator {
    return this.firstCases
      .getByRole('list', { name: 'Casos por urgencia' })
      .getByRole('listitem')
      .filter({ hasText: customerName })
  }

  /** "Abrir" of a "Lo primero" row: Casos with that case open. */
  async openFirstCase(customerName: string): Promise<void> {
    await this.firstCases.getByRole('link', { name: `Abrir el caso de ${customerName}` }).click()
  }

  /** A "Mientras no estabas" row link: its name starts "{cliente}: {frase fija}." */
  feedRow(phrase: string, customerName: string): Locator {
    return this.feed.getByRole('link', {
      name: new RegExp(`^${escapeRegExp(customerName)}: ${escapeRegExp(phrase)}\\.`),
    })
  }

  /** A status tile (link to Casos with that filter). */
  tile(label: StatusTileLabel): Locator {
    return this.tiles.getByRole('link', {
      name: new RegExp(`^\\d+ ${escapeRegExp(label)}(, [^.]+)?\\. Ver en Casos$`),
    })
  }
}
