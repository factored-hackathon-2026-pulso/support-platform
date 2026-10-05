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

// ── Copy (es | pt) ───────────────────────────────────────────────────────────

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

const COPY: Record<Language, AssistantCopy> = {
  es: {
    name: 'Asistente virtual',
    typing: 'El asistente virtual está escribiendo…',
    askPerson: 'Hablar con una persona',
    confirmTitle: 'Confirma para seguir',
    yes: 'Sí',
    no: 'No',
    expired: 'Esta confirmación venció.',
    stepUpTitle: 'Confirma que eres tú',
    stepUpReason: 'El asistente lo necesita para seguir con lo que pediste.',
    codeLabel: 'Código de verificación',
    verify: 'Verificar',
    simulated: `Código simulado de desarrollo: ${SIMULATED_STEP_UP_CODE}`,
    statusLine: 'Te atiende el asistente virtual',
    handingOver: 'Te estamos pasando con una persona del equipo…',
    surveyTitle: '¿Cómo te atendió el asistente virtual?',
    attendedBy: 'Te atendió el asistente virtual',
  },
  pt: {
    name: 'Assistente virtual',
    typing: 'O assistente virtual está escrevendo…',
    askPerson: 'Falar com uma pessoa',
    confirmTitle: 'Confirme para continuar',
    yes: 'Sim',
    no: 'Não',
    expired: 'Esta confirmação venceu.',
    stepUpTitle: 'Confirme que é você',
    stepUpReason: 'O assistente precisa disso para continuar com o seu pedido.',
    codeLabel: 'Código de verificação',
    verify: 'Verificar',
    simulated: `Código simulado de desenvolvimento: ${SIMULATED_STEP_UP_CODE}`,
    statusLine: 'Você está falando com o assistente virtual',
    handingOver: 'Estamos te passando para uma pessoa da equipe…',
    surveyTitle: 'Como foi o atendimento do assistente virtual?',
    attendedBy: 'Atendida pelo assistente virtual',
  },
}

export function assistantCopy(language: Language): AssistantCopy {
  return COPY[language] ?? COPY.es
}

/** "Vence a las 19:28" / "Vence às 19:28" in the viewer's zone. */
export function confirmationExpiry(
  confirmation: Pick<AssistantConfirmation, 'expiresAt'>,
  language: Language,
): string {
  const time = formatTime(confirmation.expiresAt)
  return language === 'pt' ? `Vence às ${time}` : `Vence a las ${time}`
}

/** "Código incorrecto. Te quedan 2 intentos." (one attempt: "1 intento"). */
export function wrongCodeMessage(remaining: number, language: Language): string {
  if (language === 'pt') {
    return `Código incorreto. ${remaining === 1 ? 'Resta 1 tentativa' : `Restam ${remaining} tentativas`}.`
  }
  return `Código incorrecto. Te ${remaining === 1 ? 'queda 1 intento' : `quedan ${remaining} intentos`}.`
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
  const pt = language === 'pt'
  const fail = (message: string, refetch = false): AssistantFailure => ({
    message,
    refetch,
    remainingAttempts: null,
  })
  if (isApiProblem(error, 'invalid_step_up_code')) {
    const remaining = Math.max(0, error.numberExtension('remainingAttempts') ?? 0)
    if (remaining === 0) {
      return {
        message: pt
          ? 'Código incorreto. Vamos te passar para uma pessoa da equipe.'
          : 'Código incorrecto. Te pasamos con una persona del equipo.',
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
    return fail(
      pt
        ? 'Uma pessoa da equipe já está com a sua conversa.'
        : 'Una persona del equipo ya tiene tu conversación.',
      true,
    )
  }
  if (isApiProblem(error, 'assistant_busy')) {
    return fail(
      pt
        ? 'O assistente ainda está respondendo. Tente de novo em um instante.'
        : 'El asistente todavía está respondiendo. Inténtalo en un momento.',
      true,
    )
  }
  if (isApiProblem(error, 'confirmation_expired')) {
    return fail(
      pt
        ? 'A confirmação venceu. Escreva de novo o que você precisa.'
        : 'La confirmación venció. Escribe de nuevo lo que necesitas.',
      true,
    )
  }
  if (
    isApiProblem(error, 'confirmation_not_pending') ||
    isApiProblem(error, 'step_up_not_pending')
  ) {
    return fail(pt ? 'Isso já foi respondido.' : 'Eso ya se respondió.', true)
  }
  if (isApiProblem(error, 'assistant_disabled')) {
    return fail(
      pt ? 'O assistente não está disponível agora.' : 'El asistente no está disponible ahora.',
      true,
    )
  }
  if (isApiProblem(error, 'validation_error')) {
    return fail(pt ? 'Digite os 6 números do código.' : 'Escribe los 6 números del código.')
  }
  if (isApiProblem(error, 'network_error')) {
    return fail(pt ? 'Sem conexão. Tente de novo.' : 'No hay conexión. Inténtalo de nuevo.')
  }
  const generic: Record<AssistantAction, [string, string]> = {
    confirm: [
      'No pudimos enviar tu respuesta. Inténtalo de nuevo.',
      'Não foi possível enviar sua resposta. Tente de novo.',
    ],
    step_up: [
      'No pudimos verificar el código. Inténtalo de nuevo.',
      'Não foi possível verificar o código. Tente de novo.',
    ],
    person: [
      'No pudimos pasarte con una persona. Inténtalo de nuevo.',
      'Não foi possível te passar para uma pessoa. Tente de novo.',
    ],
  }
  const [es, ptText] = generic[action]
  return fail(pt ? ptText : es)
}

/**
 * A call or an email the bank cannot take while the assistant holds the chat (`409
 * assistant_active`): say where the conversation is and offer "Hablar con una persona".
 */
export function isAssistantActive(error: unknown): boolean {
  return isApiProblem(error, 'assistant_active')
}

export function assistantActiveMessage(language: Language): string {
  return language === 'pt'
    ? 'O assistente virtual está te atendendo pelo chat. Escreva por lá ou peça para falar com uma pessoa.'
    : 'El asistente virtual te está atendiendo por chat. Escríbele por ahí o pide hablar con una persona.'
}
