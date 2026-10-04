import { expect, type Locator, type Page } from '@playwright/test'
import { startsWithName, type DemoCustomerRef } from '../data'

const COPY = {
  es: {
    log: 'Conversación con soporte',
    messages: 'Mensajes',
    input: 'Escribe tu mensaje',
    searching: 'Buscando a una persona del equipo…',
    withAgent: (name: string) => `Te atiende ${name}, de LATAM Bank`,
    ended: 'Conversación terminada',
    you: 'Tú',
    past: 'Conversaciones anteriores',
    showPast: /^Ver conversaciones anteriores \(\d+\)$/,
    survey: (agent: string) => `¿Cómo te atendió ${agent}?`,
    anySurvey: /^¿Cómo te atendió /,
    skip: 'Ahora no',
    comment: '¿Quieres contarnos algo más? (opcional)',
    thanks: (label: string) => `¡Gracias! Calificaste: ${label}`,
    callSection: 'Llamada con el banco',
    callLines: 'Transcripción de la llamada',
    say: 'Lo que dices',
    hangUp: 'Colgar',
    answer: 'Contestar',
    dialing: 'Llamando…',
    onHold: (agent: string) => `${agent} te puso en espera`,
    callEnded: /^Llamada terminada/,
    mailThread: 'Correos del hilo',
    mailSubject: 'Asunto',
    mailBody: 'Mensaje',
    newMark: 'Nuevo',
  },
  pt: {
    log: 'Conversa com o suporte',
    messages: 'Mensagens',
    input: 'Escreva sua mensagem',
    searching: 'Procurando uma pessoa da equipe…',
    withAgent: (name: string) => `Você está falando com ${name}, do LATAM Bank`,
    ended: 'Conversa encerrada',
    you: 'Você',
    past: 'Conversas anteriores',
    showPast: /^Ver conversas anteriores \(\d+\)$/,
    survey: (agent: string) => `Como foi o atendimento de ${agent}?`,
    anySurvey: /^Como foi o atendimento de /,
    skip: 'Agora não',
    comment: 'Quer contar algo mais? (opcional)',
    thanks: (label: string) => `Obrigado! Você avaliou: ${label}`,
    callSection: 'Ligação com o banco',
    callLines: 'Transcrição da ligação',
    say: 'O que você diz',
    hangUp: 'Desligar',
    answer: 'Atender',
    dialing: 'Ligando…',
    onHold: (agent: string) => `${agent} colocou você em espera`,
    callEnded: /^Ligação encerrada/,
    mailThread: 'E-mails da conversa',
    mailSubject: 'Assunto',
    mailBody: 'Mensagem',
    newMark: 'Novo',
  },
} as const

/** The channel cards of the simulator (slice 12): "Chat", "Llamar", "Escribir un correo". */
export type SimulatorChannel = 'Chat' | 'Llamar' | 'Escribir un correo'

/**
 * The customer simulator (`/cliente`), speaking as one seeded customer by chat, call or email.
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

  /** Opens the simulator, picks the customer and then the channel (the chat by default). */
  async open(channel: SimulatorChannel = 'Chat'): Promise<void> {
    await this.page.goto('/cliente')
    await this.page
      .getByRole('region', { name: 'Elige un cliente de ejemplo' })
      .getByRole('button', { name: startsWithName(this.customer.name) })
      .click()
    await expect(this.page.getByText(`Hablando como ${this.customer.name}`)).toBeVisible()
    await this.pickChannel(channel)
  }

  /** "¿Cómo se comunica … con el banco?" → one of the three cards. */
  async pickChannel(channel: SimulatorChannel): Promise<void> {
    await this.page
      .getByRole('region', { name: /^¿Cómo se comunica .+ con el banco\?$/ })
      .getByRole('button', { name: new RegExp(`^${channel}`) })
      .click()
    await expect(this.page).toHaveURL(/[?&]canal=/)
  }

  // ── Slice 12: the call ──────────────────────────────────────────────────────

  get callView(): Locator {
    return this.page.getByRole('region', { name: this.copy.callSection })
  }

  /** The call's title line ("Llamando…", "Te atiende Daniela", "Llamada terminada, …"). */
  callTitle(text: string | RegExp): Locator {
    return this.callView.getByRole('status').filter({ hasText: text })
  }

  /** Lines of the call, in order. */
  get callLines(): Locator {
    return this.callView.getByRole('list', { name: this.copy.callLines }).getByRole('listitem')
  }

  /** Says something on the line (the box is enabled only while talking). */
  async say(text: string): Promise<void> {
    const input = this.callView.getByRole('textbox', { name: this.copy.say })
    await input.fill(text)
    await input.press('Enter')
    await expect(input).toHaveValue('')
    await expect(this.callLines.filter({ hasText: text })).toHaveCount(1)
  }

  async hangUp(): Promise<void> {
    await this.callView.getByRole('button', { name: this.copy.hangUp }).click()
    await expect(this.callTitle(this.copy.callEnded)).toBeVisible()
  }

  // ── Slice 12: the email ─────────────────────────────────────────────────────

  /** The emails (and notices) of the thread, in order. */
  get mails(): Locator {
    return this.page.getByRole('list', { name: this.copy.mailThread }).getByRole('listitem')
  }

  /** A new email (Asunto + Mensaje) or a reply in the thread (Mensaje only). */
  async email(body: string, subject?: string): Promise<void> {
    if (subject) await this.page.getByRole('textbox', { name: this.copy.mailSubject }).fill(subject)
    const message = this.page.getByRole('textbox', { name: this.copy.mailBody })
    await message.fill(body)
    await this.page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(message).toHaveValue('')
    await expect(this.mails.filter({ hasText: body.slice(0, 40) })).toHaveCount(1)
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

  /**
   * Slice 7: the satisfaction survey of a closed conversation (it replaces the input);
   * `agent` names the analyst in its title, or any survey without it.
   */
  survey(agent?: string): Locator {
    return this.page.getByRole('form', {
      name: agent ? this.copy.survey(agent) : this.copy.anySurvey,
    })
  }

  /** Picks a face (its card: the native radio is visually hidden), comments and sends. */
  async rate(label: string, comment?: string): Promise<void> {
    const survey = this.survey()
    const radio = survey.getByRole('radio', { name: label, exact: true })
    await survey
      .locator('label')
      .filter({ has: this.page.getByRole('radio', { name: label, exact: true }) })
      .click()
    await expect(radio).toBeChecked()
    if (comment) await survey.getByRole('textbox', { name: this.copy.comment }).fill(comment)
    await survey.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(this.thanks(label)).toBeVisible()
    await expect(survey).toHaveCount(0)
  }

  /** "¡Gracias! Calificaste: Excelente". */
  thanks(label: string): Locator {
    return this.page.getByText(this.copy.thanks(label), { exact: true })
  }

  /**
   * Writes a message. A closed, unrated conversation first shows the survey instead of
   * the input: this customer answers "Ahora no" and writes (a new conversation opens).
   */
  async send(text: string): Promise<void> {
    const input = this.page.getByRole('textbox', { name: this.copy.input })
    const survey = this.survey()
    await expect(input.or(survey)).toBeVisible()
    if (await survey.isVisible()) {
      await survey.getByRole('button', { name: this.copy.skip }).click()
      await expect(survey).toHaveCount(0)
    }
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
