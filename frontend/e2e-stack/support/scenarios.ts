import { test, type Page } from '@playwright/test'
import type { AssistantChat, ConversationOutcome } from './assistant-chat'
import type { CustomerConversationResponse, StackApi } from './stack-api'

/**
 * What the customers write. agent-core's e2e registry (demo doubles, synthetic data) decides
 * what follows: reception routes a charge the customer does not recognise to "disputas", which
 * asks which charge it is and stays with the customer; a charge over 500 USD (Electro Norte, 640)
 * escalates by policy with a handoff packet; a smaller one (Tienda Aurora, 120.50) asks to
 * confirm the dispute and, to file it, the second factor.
 */
export const SCRIPTS = {
  /** Opens a conversation the assistant keeps (it asks which charge). */
  opener: {
    es: 'Hola, no reconozco un cargo en mi tarjeta',
    pt: 'Olá, não reconheço uma cobrança no meu cartão',
  },
  /** Over the amount policy: escalates to people with a handoff packet. */
  largeDispute: [
    'Hola, no reconozco un cargo de 640 dólares en Electro Norte en mi tarjeta',
    'Es el cargo de 640 dólares de Electro Norte, yo no lo hice',
    'Sí, ese es, el de 640 dólares',
  ],
  /** Under the amount policy: confirmation, then the second factor to file the dispute. */
  smallDispute: [
    'No reconozco un cargo de 120 dólares en Tienda Aurora en mi tarjeta',
    'Es el cargo de 120 dólares de Tienda Aurora, yo no lo hice',
    'Sí, ese es, el de 120 dólares',
  ],
} as const

export const ATTEMPTS = 3

/**
 * agent-core limits the turns of one principal per window (`AGENTCORE_RATE_WINDOW_SECONDS`, 60 s
 * by default) and every scenario writes as the same demo customer: after a `rate_limited`
 * hand-over the next attempt waits the window out.
 */
const RATE_WINDOW_MS = 61_000

function describe(state: CustomerConversationResponse): string {
  const conversation = state.conversation
  if (!conversation) return 'no conversation'
  const assistant = conversation.assistant
  return `status=${conversation.status} confirmation=${!!assistant?.confirmation} stepUp=${!!assistant?.stepUp}`
}

/**
 * Runs `attempt` until `done` accepts its result, at most `ATTEMPTS` times. Between attempts the
 * conversation is closed (the next message opens a new one); when agent-core refused for its rate
 * limit, it first waits for the window. Every retry is noted on the report (model variance).
 */
async function retrying<T>(
  chat: AssistantChat,
  stack: StackApi,
  attempt: () => Promise<T>,
  done: (result: T) => Promise<boolean> | boolean,
  stateOf: (result: T) => CustomerConversationResponse,
): Promise<T> {
  let last = ''
  for (let n = 1; n <= ATTEMPTS; n += 1) {
    const result = await attempt()
    if (await done(result)) return result
    const state = stateOf(result)
    const caseId = state.conversation?.caseId
    const failure = caseId ? await stack.failureCode(caseId) : null
    last = `${describe(state)}${failure ? ` failure=${failure}` : ''}`
    test.info().annotations.push({ type: 'model variance', description: `attempt ${n}: ${last}` })
    await stack.releaseCustomer(chat.customer.id)
    if (failure === 'rate_limited' && n < ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RATE_WINDOW_MS))
    }
  }
  throw new Error(`the conversation never reached the outcome in ${ATTEMPTS} attempts: ${last}`)
}

/** Writes the opener until the assistant answers it (at least one of its turns after it). */
export async function answeredByAssistant(
  chat: AssistantChat,
  stack: StackApi,
  onAttempt?: () => void,
): Promise<CustomerConversationResponse> {
  const text = SCRIPTS.opener[chat.customer.language]
  return retrying(
    chat,
    stack,
    () => {
      onAttempt?.()
      return chat.ask(stack, text)
    },
    (state) => {
      const mine = state.turns.findLastIndex(
        (turn) => turn.authorRole === 'customer' && turn.text === text,
      )
      return state.turns.slice(mine + 1).some((turn) => turn.authorRole === 'assistant')
    },
    (state) => state,
  )
}

/**
 * Opens a conversation the assistant holds and is waiting on (no confirmation or second factor
 * pending).
 */
export async function holdWithAssistant(
  chat: AssistantChat,
  stack: StackApi,
): Promise<CustomerConversationResponse> {
  return retrying(
    chat,
    stack,
    () => chat.ask(stack, SCRIPTS.opener[chat.customer.language]),
    (state) => {
      const assistant = state.conversation?.assistant
      return (
        state.conversation?.status === 'with_assistant' &&
        !assistant?.confirmation &&
        !assistant?.stepUp
      )
    },
    (state) => state,
  )
}

/** Runs a script until `done` says the outcome is the one the scenario needs. */
export async function converseUntil(
  chat: AssistantChat,
  stack: StackApi,
  script: readonly string[],
  done: (outcome: ConversationOutcome) => Promise<boolean> | boolean,
): Promise<ConversationOutcome> {
  return retrying(
    chat,
    stack,
    () => chat.converse(stack, script),
    done,
    (outcome) => outcome.state,
  )
}

/** Portuguese and not Spanish, by a few unmistakable words (never the model's exact text). */
export function looksPortuguese(text: string): boolean {
  // `\b` is ASCII-only: words are delimited by "not a letter" instead.
  const portuguese =
    /[ãõç]|(?<!\p{L})(você|não|um|uma|seu|sua|vou|pessoa|qual|obrigad[oa])(?!\p{L})/iu
  const spanish = /[ñ¿¡]|(?<!\p{L})(usted|puedo|tarjeta|ayudarte|cuál|gracias)(?!\p{L})/iu
  return portuguese.test(text) && !spanish.test(text)
}

/** Attaches a screenshot of this moment to the report (`pnpm exec playwright show-report`). */
export async function snap(page: Page, name: string): Promise<void> {
  const path = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path })
  await test.info().attach(name, { path, contentType: 'image/png' })
}
