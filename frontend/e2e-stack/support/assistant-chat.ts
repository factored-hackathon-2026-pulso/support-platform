import { expect, type Locator } from '@playwright/test'
import { CustomerSimulatorPage } from '../../e2e/support/pages/customer-simulator-page'
import type { CustomerConversationResponse, StackApi } from './stack-api'
import { snap } from './scenarios'

/** The simulator's assistant copy (`features/customer-chat/assistant.ts`), per language. */
const COPY = {
  es: {
    name: 'Asistente virtual',
    typing: 'El asistente virtual está escribiendo…',
    askPerson: 'Hablar con una persona',
    statusLine: 'Te atiende el asistente virtual',
    handingOver: 'Te estamos pasando con una persona del equipo…',
    confirmTitle: 'Confirma para seguir',
    yes: 'Sí',
    stepUpTitle: 'Confirma que eres tú',
    codeLabel: 'Código de verificación',
    verify: 'Verificar',
    simulated: 'Código simulado de desarrollo: 000000',
    wrongCode: 'Código incorrecto. Te quedan 2 intentos.',
    confirmed: 'Confirmaste la acción.',
    verified: 'Verificamos tu identidad.',
    survey: '¿Cómo te atendió el asistente virtual?',
    handoverNotice: 'Te paso con una persona del equipo para que siga con tu caso.',
  },
  pt: {
    name: 'Assistente virtual',
    typing: 'O assistente virtual está escrevendo…',
    askPerson: 'Falar com uma pessoa',
    statusLine: 'Você está falando com o assistente virtual',
    handingOver: 'Estamos te passando para uma pessoa da equipe…',
    confirmTitle: 'Confirme para continuar',
    yes: 'Sim',
    stepUpTitle: 'Confirme que é você',
    codeLabel: 'Código de verificação',
    verify: 'Verificar',
    simulated: 'Código simulado de desenvolvimento: 000000',
    wrongCode: 'Código incorreto. Restam 2 tentativas.',
    confirmed: 'Você confirmou a ação.',
    verified: 'Verificamos a sua identidade.',
    survey: 'Como foi o atendimento do assistente virtual?',
    handoverNotice: 'Vou te passar para uma pessoa da equipe para continuar com o seu caso.',
  },
} as const

/** What a scripted conversation went through (the model decides which, not the script). */
export interface ConversationOutcome {
  state: CustomerConversationResponse
  confirmations: number
  stepUps: number
}

/**
 * The customer simulator while the assistant holds the conversation (slice 19 §2): its bubbles,
 * the typing pill, "Hablar con una persona", the confirmation card and the second-factor prompt.
 * Decisions follow the API's conversation (the screens' own source of truth); actions and
 * checks go through the screen.
 */
export class AssistantChat extends CustomerSimulatorPage {
  /**
   * Opens the chat and waits until the conversation has loaded: until then the input shows even
   * for a closed, unrated conversation, whose survey replaces it a moment later.
   */
  override async open(): Promise<void> {
    await super.open()
    await expect(this.page.getByRole('log', { name: this.copy.log })).toBeVisible()
  }

  get assistantCopy() {
    return COPY[this.customer.language]
  }

  /** The assistant's turns in the current conversation (bot mark + "Asistente virtual"). */
  get assistantTurns(): Locator {
    return this.messages.filter({
      has: this.page.getByText(this.assistantCopy.name, { exact: true }),
    })
  }

  get typing(): Locator {
    return this.page.getByText(this.assistantCopy.typing, { exact: true })
  }

  get askPersonButton(): Locator {
    return this.page.getByRole('button', { name: this.assistantCopy.askPerson, exact: true })
  }

  /** The header's state line ("Te atiende el asistente virtual", "Te atiende Tomás, …"). */
  headerLine(text: string): Locator {
    return this.page.getByRole('main').getByText(text, { exact: true })
  }

  get confirmationCard(): Locator {
    return this.page.getByRole('region', { name: this.assistantCopy.confirmTitle })
  }

  get stepUpCard(): Locator {
    return this.page.getByRole('form', { name: this.assistantCopy.stepUpTitle })
  }

  /** A platform notice in the log ("Confirmaste la acción.", the hand-over notice…). */
  notice(text: string): Locator {
    return this.messages.filter({ hasText: text })
  }

  /** Sends a message and waits for the assistant to answer it (or to let the conversation go). */
  async ask(api: StackApi, text: string): Promise<CustomerConversationResponse> {
    await this.send(text)
    return api.settled(this.customer.id, { afterText: text })
  }

  /** "Sí" on the confirmation card; waits for what the assistant does next. */
  async confirm(api: StackApi, state: CustomerConversationResponse) {
    const card = this.confirmationCard
    await expect(card).toBeVisible()
    await expect(card.getByText(/^Vence a las |^Vence às /)).toBeVisible()
    await snap(this.page, 'confirmation-card')
    await card.getByRole('button', { name: this.assistantCopy.yes, exact: true }).click()
    await expect(card).toHaveCount(0, { timeout: 30_000 })
    await expect(this.notice(this.assistantCopy.confirmed).last()).toBeVisible()
    return api.settled(this.customer.id, {
      afterSequence: state.conversation?.lastSequence ?? 0,
    })
  }

  /**
   * The simulated second factor: a wrong code first (the card says how many attempts are left),
   * then the development code; waits for what the assistant does next.
   */
  async verifyStepUp(api: StackApi, state: CustomerConversationResponse) {
    const card = this.stepUpCard
    await expect(card).toBeVisible()
    await expect(card.getByText(this.assistantCopy.simulated, { exact: true })).toBeVisible()
    await snap(this.page, 'step-up-card')
    const code = card.getByRole('textbox', { name: this.assistantCopy.codeLabel })
    const verify = card.getByRole('button', { name: this.assistantCopy.verify, exact: true })
    await code.fill('111111')
    await verify.click()
    await expect(card.getByRole('alert')).toHaveText(this.assistantCopy.wrongCode)
    await code.fill('000000')
    await verify.click()
    await expect(card).toHaveCount(0, { timeout: 30_000 })
    await expect(this.notice(this.assistantCopy.verified).last()).toBeVisible()
    return api.settled(this.customer.id, {
      afterSequence: state.conversation?.lastSequence ?? 0,
    })
  }

  /**
   * Writes the script one message at a time, answering "Sí" to every confirmation and the
   * simulated code to every second factor, until the assistant lets the conversation go (it
   * resolves or hands it to people) or the script ends.
   */
  async converse(api: StackApi, script: readonly string[]): Promise<ConversationOutcome> {
    let confirmations = 0
    let stepUps = 0
    let state: CustomerConversationResponse | null = null
    for (const text of script) {
      state = await this.ask(api, text)
      for (let step = 0; step < 4; step += 1) {
        const conversation = state.conversation
        const assistant = conversation?.status === 'with_assistant' ? conversation.assistant : null
        if (assistant?.confirmation) {
          confirmations += 1
          state = await this.confirm(api, state)
        } else if (assistant?.stepUp) {
          stepUps += 1
          state = await this.verifyStepUp(api, state)
        } else {
          break
        }
      }
      if (state.conversation?.status !== 'with_assistant') break
    }
    if (!state) throw new Error('empty script')
    return { state, confirmations, stepUps }
  }
}
