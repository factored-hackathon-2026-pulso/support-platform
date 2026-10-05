/**
 * The assistant in the customer simulator (slice 19; contract docs/platform/api/slice-14-assistant.md
 * §3): what the chat shows while `status` is `with_assistant` (the typing pill, the confirmation
 * card, the second-factor prompt and "Hablar con una persona") and the copy of every failure of
 * §8, in the customer's language. Pure, unit-tested in assistant.test.ts.
 *
 * The assistant states follow the conversation (the server's truth), not the AI switch: a
 * conversation can only be `with_assistant` while AI is on, because turning AI off hands the
 * assistant's open conversations to people (slice 19 backend). The controls stay usable during
 * that hand-over, so a customer is never left without a way to reach a person.
 */
import { isApiProblem } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { customerT } from './locale'
import type { CustomerConversation, CustomerTurn, Language } from './types'

export type AssistantState = NonNullable<CustomerConversation['assistant']>
export type AssistantConfirmation = NonNullable<AssistantState['confirmation']>
export type AssistantStepUp = NonNullable<AssistantState['stepUp']>

/** What the bottom of the chat shows while the assistant holds the conversation. */
export interface AssistantView {
  /** "El asistente virtual está escribiendo…" (an answer is on its way). */
  working: boolean
  confirmation: AssistantConfirmation | null
  stepUp: AssistantStepUp | null
  /** "Hablar con una persona", always offered while the assistant holds the conversation. */
  canAskPerson: boolean
}

const IDLE: AssistantView = {
  working: false,
  confirmation: null,
  stepUp: null,
  canAskPerson: false,
}

export function assistantView(conversation: CustomerConversation | null): AssistantView {
  if (conversation?.status !== 'with_assistant') return IDLE
  const state = conversation.assistant
  return {
    working: state?.working ?? false,
    // At most one of them is set (contract §3.1); the confirmation wins if both ever were.
    confirmation: state?.confirmation ?? null,
    stepUp: state?.confirmation ? null : (state?.stepUp ?? null),
    canAskPerson: true,
  }
}

/** The assistant's display names, as the server localises them (`agentName`, `authorName`). */
const ASSISTANT_NAMES = new Set(['Asistente virtual', 'Assistente virtual'])

export function isAssistantName(name: string | null | undefined): boolean {
  return name ? ASSISTANT_NAMES.has(name.trim()) : false
}

/** Whether the assistant spoke in this conversation (its turns stay after a hand-over). */
export function hadAssistant(turns: readonly Pick<CustomerTurn, 'authorRole'>[]): boolean {
  return turns.some((turn) => turn.authorRole === 'assistant')
}

/** Case, spacing and Unicode form apart, the same words (to compare two texts). */
function comparable(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Whether the assistant's last message already says the confirmation's summary: agent-core
 * often sends the same question as the turn and as the confirmation ("Voy a radicar la disputa
 * del cargo. ¿Confirmas?"). Then the card shows only its title, deadline and buttons.
 */
export function confirmationAlreadySaid(
  summary: string,
  turns: readonly Pick<CustomerTurn, 'authorRole' | 'text'>[],
): boolean {
  const wanted = comparable(summary)
  if (!wanted) return false
  const last = turns.findLast((turn) => turn.authorRole === 'assistant')
  return last ? comparable(last.text).includes(wanted) : false
}

/** The simulated second-factor code the backend accepts by default (`CC_ASSISTANT_STEP_UP_CODE`). */
export const SIMULATED_STEP_UP_CODE = '000000'

export const STEP_UP_CODE_LENGTH = 6

/** Digits only, at most six (what the code box keeps). */
export function normalizeStepUpCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, STEP_UP_CODE_LENGTH)
}

/** Whether the confirmation's own deadline has passed (the server says so too, `confirmation_expired`). */
export function isConfirmationExpired(
  confirmation: Pick<AssistantConfirmation, 'expiresAt'>,
  now: number,
): boolean {
  return new Date(confirmation.expiresAt).getTime() <= now
}

// ── Copy (the customer's language) ───────────────────────────────────────────

export interface AssistantCopy {
  name: string
  typing: string
  askPerson: string
  confirmTitle: string
  yes: string
  no: string
  expired: string
  stepUpTitle: string
  stepUpReason: string
  codeLabel: string
  verify: string
  simulated: string
  /** "Te atiende el asistente virtual" (header state line). */
  statusLine: string
  /** "Te estamos pasando con una persona del equipo…" (after the assistant, before a person). */
  handingOver: string
  /** The survey's "¿Cómo te atendió el asistente virtual?". */
  surveyTitle: string
  /** A past block's byline. */
  attendedBy: string
}

/** Everything the assistant's controls say, in the customer's language (`customer:assistant`). */
export function assistantCopy(language: Language): AssistantCopy {
  const t = customerT(language)
  return {
    name: t('assistant.name'),
    typing: t('assistant.typing'),
    askPerson: t('assistant.askPerson'),
    confirmTitle: t('assistant.confirmTitle'),
    yes: t('assistant.yes'),
    no: t('assistant.no'),
    expired: t('assistant.expired'),
    stepUpTitle: t('assistant.stepUpTitle'),
    stepUpReason: t('assistant.stepUpReason'),
    codeLabel: t('assistant.codeLabel'),
    verify: t('assistant.verify'),
    simulated: t('assistant.simulated', { code: SIMULATED_STEP_UP_CODE }),
    statusLine: t('assistant.statusLine'),
    handingOver: t('assistant.handingOver'),
    surveyTitle: t('assistant.surveyTitle'),
    attendedBy: t('assistant.attendedBy'),
  }
}

/** "Vence a las 19:28" / "Vence às 19:28" in the viewer's zone. */
export function confirmationExpiry(
  confirmation: Pick<AssistantConfirmation, 'expiresAt'>,
  language: Language,
): string {
  return customerT(language)('assistant.expiresAt', { time: formatTime(confirmation.expiresAt) })
}

/** "Código incorrecto. Te quedan 2 intentos." (one attempt: "1 intento"). */
export function wrongCodeMessage(remaining: number, language: Language): string {
  return customerT(language)('assistant.wrongCode', { count: remaining })
}

// ── Failures (contract §8) ───────────────────────────────────────────────────

export type AssistantAction = 'confirm' | 'step_up' | 'person'

export interface AssistantFailure {
  message: string
  /** The conversation moved on (people have it, the confirmation was answered…): refetch it. */
  refetch: boolean
  /** Attempts left after a wrong code (`invalid_step_up_code`), else null. */
  remainingAttempts: number | null
}

/** One copy per problem code, in the customer's language. */
export function describeAssistantFailure(
  error: unknown,
  action: AssistantAction,
  language: Language,
): AssistantFailure {
  const t = customerT(language)
  const fail = (message: string, refetch = false): AssistantFailure => ({
    message,
    refetch,
    remainingAttempts: null,
  })
  if (isApiProblem(error, 'invalid_step_up_code')) {
    const remaining = Math.max(0, error.numberExtension('remainingAttempts') ?? 0)
    if (remaining === 0) {
      return {
        message: t('assistant.failure.handedOver'),
        refetch: true,
        remainingAttempts: 0,
      }
    }
    return {
      message: wrongCodeMessage(remaining, language),
      refetch: false,
      remainingAttempts: remaining,
    }
  }
  if (isApiProblem(error, 'assistant_not_active')) {
    return fail(t('assistant.failure.notActive'), true)
  }
  if (isApiProblem(error, 'assistant_busy')) {
    return fail(t('assistant.failure.busy'), true)
  }
  if (isApiProblem(error, 'confirmation_expired')) {
    return fail(t('assistant.failure.confirmationExpired'), true)
  }
  if (
    isApiProblem(error, 'confirmation_not_pending') ||
    isApiProblem(error, 'step_up_not_pending')
  ) {
    return fail(t('assistant.failure.answered'), true)
  }
  if (isApiProblem(error, 'assistant_disabled')) {
    return fail(t('assistant.failure.disabled'), true)
  }
  if (isApiProblem(error, 'validation_error')) {
    return fail(t('assistant.failure.codeFormat'))
  }
  if (isApiProblem(error, 'network_error')) {
    return fail(t('networkFailure'))
  }
  return fail(t(`assistant.failure.${action}`))
}

/**
 * A call or an email the bank cannot take while the assistant holds the chat (`409
 * assistant_active`): say where the conversation is and offer "Hablar con una persona".
 */
export function isAssistantActive(error: unknown): boolean {
  return isApiProblem(error, 'assistant_active')
}

export function assistantActiveMessage(language: Language): string {
  return customerT(language)('assistant.active')
}
