import { expect, type Locator, type Page } from '@playwright/test'
import { startsWithName, type DemoCustomerRef } from '../data'

const COPY = {
  es: {
    log: 'Conversación con soporte',
    messages: 'Mensajes',
    input: 'Escribe tu mensaje',
    searching: 'Buscando a una persona del equipo…',
    withAgent: (name: string) => `Te atiende ${name} · LATAM Bank`,
    ended: 'Conversación terminada',
    you: 'Tú',
    past: 'Conversaciones anteriores',
    showPast: /^Ver conversaciones anteriores \(\d+\)$/,
  },
  pt: {
    log: 'Conversa com o suporte',
    messages: 'Mensagens',
    input: 'Escreva sua mensagem',
    searching: 'Procurando uma pessoa da equipe…',
    withAgent: (name: string) => `Você está falando com ${name} · LATAM Bank`,
    ended: 'Conversa encerrada',
    you: 'Você',
    past: 'Conversas anteriores',
    showPast: /^Ver conversas anteriores \(\d+\)$/,
  },
} as const

/**
 * The customer chat simulator (`/cliente`), speaking as one seeded customer.
 * The customer token lives in this tab's sessionStorage, so a reload keeps the chat.
 */
export class CustomerSimulatorPage {
  readonly copy: (typeof COPY)['es' | 'pt']

  readonly page: Page
  readonly customer: DemoCustomerRef

  constructor(page: Page, customer: DemoCustomerRef) {
    this.page = page
    this.customer = customer
    this.copy = COPY[customer.language]
  }

  /** Opens the simulator and picks the customer. */
  async open(): Promise<void> {
    await this.page.goto('/cliente')
    await this.page
      .getByRole('region', { name: 'Elige un cliente de ejemplo' })
      .getByRole('button', { name: startsWithName(this.customer.name) })
      .click()
    await expect(this.page.getByText(`Hablando como ${this.customer.name}`)).toBeVisible()
  }

  /** The current conversation's messages, in order (past conversations are outside it). */
  get messages(): Locator {
    return this.page
      .getByRole('log', { name: this.copy.log })
      .getByRole('list', { name: this.copy.messages })
      .getByRole('listitem')
  }

  /** One of the customer's own messages ("Tú: …"). */
  own(text: string): Locator {
    return this.messages.filter({ hasText: `${this.copy.you}: ${text}` })
  }

  /** The header state line. */
  status(line: 'searching' | 'ended' | { agent: string }): Locator {
    const text =
      line === 'searching'
        ? this.copy.searching
        : line === 'ended'
          ? this.copy.ended
          : this.copy.withAgent(line.agent)
    return this.page.getByRole('main').getByText(text, { exact: true })
  }

  async send(text: string): Promise<void> {
    const input = this.page.getByRole('textbox', { name: this.copy.input })
    await input.fill(text)
    await input.press('Enter')
    await expect(input).toHaveValue('')
    // Sent: the bubble is in the log and no longer "Enviando…".
    await expect(this.own(text)).toHaveCount(1)
    await expect(this.own(text)).not.toContainText('Enviando')
  }

  /** "Ver conversaciones anteriores (n)" → the collapsed past blocks. */
  async showPastConversations(): Promise<Locator> {
    await this.page.getByRole('button', { name: this.copy.showPast }).click()
    const section = this.page.getByRole('region', { name: this.copy.past })
    await expect(section).toBeVisible()
    return section
  }
}
