/**
 * Pure rules of the analyst's support panel (slice 20): which copilot surfaces show, the Q&A
 * thread as the panel renders it, the suggestions read by kind, and the Spanish copy for every
 * failure. No React, no I/O: unit-tested in model.test.ts.
 */
import { ApiProblem } from '@/lib/api'
import type {
  CopilotAsk,
  CopilotExchange,
  CopilotMessage,
  CopilotThread,
  LatestCopilotSuggestion,
  SuggestionAction,
  SuggestionEscalation,
  SuggestionReply,
  SuggestionStatus,
  SuggestionTool,
} from './types'

// ─── Stage gating ───────────────────────────────────────────────────────────

/**
 * How far the copilot goes for a case (ADR 0005 `copilot_mode`, ADR 0006 stages 1-3): `answer`
 * (stage 1: she asks), `tools` (stage 2: it also proposes reads), `drafts` (stage 3: it also
 * drafts the reply). S21 computes it per case type; S20 shows everything the backend offers.
 */
export type CopilotMode = 'answer' | 'tools' | 'drafts'

/** Slice 20: every surface (the type's stage arrives with S21). */
export const FULL_COPILOT_MODE: CopilotMode = 'drafts'

export interface CopilotSurfaces {
  /** The "Copiloto" tab (the Q&A thread). */
  copilot: boolean
  /** The "Herramientas" tab (`tool` and `action` suggestions, "Sugerir"). */
  tools: boolean
  /** The draft above the composer (`reply` suggestions). */
  draft: boolean
}

/** What each mode shows. `null` (no copilot at all, e.g. supervision): nothing. */
export function copilotSurfaces(mode: CopilotMode | null | undefined): CopilotSurfaces {
  if (!mode) return { copilot: false, tools: false, draft: false }
  return { copilot: true, tools: mode !== 'answer', draft: mode === 'drafts' }
}

// ─── The Q&A thread ─────────────────────────────────────────────────────────

/** The backend's limit for a question (slice 15 §2). */
export const MAX_QUESTION_LENGTH = 2000

/** Trimmed question, or null when there is nothing to ask or it is too long. */
export function normalizeQuestion(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_QUESTION_LENGTH) return null
  return trimmed
}

/** "12/2000" under the box. */
export function questionCounter(text: string): string {
  return `${text.trim().length}/${MAX_QUESTION_LENGTH}`
}

export type CopilotTurnState = 'answered' | 'asking' | 'failed' | 'unanswered'

/** One question and what the copilot said to it, as the panel shows it. */
export interface CopilotTurnView {
  key: string
  text: string
  createdAt: string
  /**
   * `answered`: it said something. `asking`: on its way. `failed`: this session's request failed
   * ("Reintentar", same id). `unanswered`: stored without an answer (it said nothing, or a call
   * failed before a reload): "Preguntar de nuevo" asks it as a new question.
   */
  state: CopilotTurnState
  answers: { id: string; text: string }[]
  error: string | null
  retryable: boolean
  /** Only for this session's questions: the id a retry reuses. */
  clientMessageId: string | null
}

/**
 * The thread (oldest first) plus this session's questions in flight or failed. The server stores
 * a question before it calls the copilot, so a question in flight or failed can also be in the
 * thread without an answer: the session's entry stands for it (same text), never both.
 */
export function copilotTurns(
  messages: readonly CopilotMessage[],
  asks: readonly CopilotAsk[],
): CopilotTurnView[] {
  const answersOf = new Map<string, { id: string; text: string }[]>()
  for (const message of messages) {
    if (message.role !== 'copilot' || !message.answers) continue
    const list = answersOf.get(message.answers) ?? []
    list.push({ id: message.id, text: message.text })
    answersOf.set(message.answers, list)
  }
  const pendingTexts = new Set(asks.map((ask) => ask.text))
  const turns: CopilotTurnView[] = []
  for (const message of messages) {
    if (message.role !== 'analyst') continue
    const answers = answersOf.get(message.id) ?? []
    if (answers.length === 0 && pendingTexts.has(message.text)) continue
    turns.push({
      key: message.id,
      text: message.text,
      createdAt: message.createdAt,
      state: answers.length > 0 ? 'answered' : 'unanswered',
      answers,
      error: null,
      retryable: true,
      clientMessageId: null,
    })
  }
  for (const ask of asks) {
    turns.push({
      key: ask.clientMessageId,
      text: ask.text,
      createdAt: ask.createdAt,
      state: ask.status,
      answers: [],
      error: ask.error,
      retryable: ask.retryable,
      clientMessageId: ask.clientMessageId,
    })
  }
  return turns
}

/** One question at a time (the backend answers `copilot_busy` otherwise). */
export function isAsking(asks: readonly CopilotAsk[]): boolean {
  return asks.some((ask) => ask.status === 'asking')
}

/** Adds a question, or replaces it in place (a retry keeps its position). */
export function upsertAsk(asks: readonly CopilotAsk[], ask: CopilotAsk): CopilotAsk[] {
  const known = asks.some((item) => item.clientMessageId === ask.clientMessageId)
  if (!known) return [...asks, ask]
  return asks.map((item) => (item.clientMessageId === ask.clientMessageId ? ask : item))
}

export function removeAsk(asks: readonly CopilotAsk[], clientMessageId: string): CopilotAsk[] {
  return asks.filter((item) => item.clientMessageId !== clientMessageId)
}

/** The answer of a question → the thread (the question and its answers, once each, in order). */
export function mergeExchange(thread: CopilotThread, exchange: CopilotExchange): CopilotThread {
  const known = new Set(thread.messages.map((message) => message.id))
  const added = [exchange.question, ...exchange.answers].filter((message) => {
    if (known.has(message.id)) return false
    known.add(message.id)
    return true
  })
  return added.length ? { ...thread, messages: [...thread.messages, ...added] } : thread
}

export interface AskFailure {
  message: string
  /** Asking again with the same id can help (an outage, the copilot still busy). */
  retryable: boolean
}

/** A failed question → the line under it (slice 15 §2 errors). */
export function describeAskFailure(error: unknown): AskFailure {
  if (!(error instanceof ApiProblem)) {
    return { message: 'No se pudo responder. Inténtalo de nuevo.', retryable: true }
  }
  switch (error.code) {
    case 'copilot_busy':
      return {
        message: 'El copiloto todavía responde tu pregunta anterior. Reintenta en unos segundos.',
        retryable: true,
      }
    case 'case_closed':
      return { message: 'El caso se cerró: el copiloto ya no responde.', retryable: false }
    case 'copilot_unavailable':
      return { message: 'El copiloto no tiene datos de este cliente.', retryable: false }
    case 'assistant_disabled':
      return { message: 'El copiloto no está disponible ahora.', retryable: false }
    case 'case_not_assigned':
    case 'forbidden':
      return { message: 'Este caso ya no está a tu nombre.', retryable: false }
    case 'validation_error':
    case 'invalid_value':
      return {
        message: 'La pregunta puede tener hasta 2.000 caracteres.',
        retryable: false,
      }
    case 'network_error':
      return { message: 'No hay conexión. Inténtalo de nuevo.', retryable: true }
    default:
      return {
        message: 'No se pudo responder. Inténtalo de nuevo.',
        retryable: error.status >= 500,
      }
  }
}

// ─── Copy ───────────────────────────────────────────────────────────────────

/** "Natalia" from "Natalia Guzmán Rincón". */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName
}

/** The quiet line on top of the tab: it reads, it never acts (ADR 0003 §6). */
export function copilotNotice(displayName: string): string {
  return `Consulta y calcula con los datos de ${firstName(displayName)}. No hace cambios ni le escribe al cliente.`
}

export function emptyThreadTitle(displayName: string): string {
  return `Pregúntale sobre ${firstName(displayName)}`
}

/**
 * Starter questions of the empty thread: they only fill the box. Grounded in what the dataset
 * holds about a customer (products, transactions, complaints).
 */
export const STARTER_QUESTIONS: readonly string[] = [
  '¿Qué productos tiene y en qué estado están?',
  '¿Qué movimientos tuvo en los últimos 30 días?',
  '¿Tiene reclamos anteriores y cómo se cerraron?',
]

// ─── Suggestions ────────────────────────────────────────────────────────────

/** The newest suggestion read by kind. */
export interface SuggestionView {
  id: string
  status: SuggestionStatus
  /** The customer wrote after the turns it read. */
  stale: boolean
  failureCode: string | null
  /** The draft, while nobody decided it (it leaves the list once decided). */
  reply: SuggestionReply | null
  tools: SuggestionTool[]
  actions: SuggestionAction[]
  /** Only while she has not escalated with it. */
  escalation: SuggestionEscalation | null
}

/** `GET …/latest` → the view, or null when there is none (or the suggestions are unavailable). */
export function suggestionView(latest: LatestCopilotSuggestion | undefined): SuggestionView | null {
  const suggestion = latest?.available ? latest.suggestion : null
  if (!suggestion) return null
  const view: SuggestionView = {
    id: suggestion.id,
    status: suggestion.status,
    stale: suggestion.stale,
    failureCode: suggestion.failureCode,
    reply: null,
    tools: [],
    actions: [],
    escalation: null,
  }
  for (const item of suggestion.suggestions) {
    switch (item.type) {
      case 'reply':
        if (!suggestion.replyDecision && !view.reply) view.reply = item
        break
      case 'tool':
        view.tools.push(item)
        break
      case 'action':
        view.actions.push(item)
        break
      case 'escalate':
        if (!suggestion.escalationAccepted && !view.escalation) view.escalation = item
        break
    }
  }
  return view
}

/**
 * "Usar" on a tool: the predefined question it asks the copilot through her thread (ADR 0005 §3:
 * a tool is a read, answered in text). The tool's id helps the copilot pick it.
 */
export function toolQuestion(tool: Pick<SuggestionTool, 'label' | 'tool'>): string {
  return `Consulta ${tool.label} (${tool.tool}) para este cliente y dime qué encontraste.`
}

/** The newest time she used that tool, as a thread turn (its answer is the tool's result). */
export function toolResult(
  turns: readonly CopilotTurnView[],
  tool: Pick<SuggestionTool, 'label' | 'tool'>,
): CopilotTurnView | null {
  const question = toolQuestion(tool)
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn?.text === question) return turn
  }
  return null
}

function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ''
}

/**
 * agent-core's reason code for an escalation (`policy:…`, `rule:…`; ADR 0005 §4: it comes from
 * rules, not from the model) → a short Spanish phrase.
 */
export function escalationReason(code: string): string {
  const [prefix, ...rest] = code.split(':')
  const name = humanize(rest.join(':'))
  if (prefix === 'policy' && name) return `Una política lo pide: ${name}`
  if (prefix === 'rule' && name) return `Una regla del copiloto lo pide: ${name}`
  return humanize(code) || 'El copiloto recomienda escalarlo'
}

export interface SuggestFailure {
  message: string
  /** "Reintentar" with the same key can help. */
  retry: boolean
}

/** "Sugerir" failed → the line in "Herramientas" (slice 15b §2). */
export function describeSuggestFailure(error: unknown): SuggestFailure {
  if (!(error instanceof ApiProblem)) {
    return { message: 'No se pudo preparar la sugerencia. Inténtalo de nuevo.', retry: true }
  }
  switch (error.code) {
    case 'copilot_busy':
      return {
        message: 'El copiloto ya está preparando una sugerencia. Espera unos segundos.',
        retry: false,
      }
    case 'case_closed':
      return { message: 'El caso se cerró: el copiloto ya no sugiere.', retry: false }
    case 'copilot_unavailable':
      return { message: 'El copiloto no tiene datos de este cliente.', retry: false }
    case 'assistant_disabled':
      return { message: 'Las sugerencias del copiloto no están disponibles ahora.', retry: false }
    case 'case_not_assigned':
    case 'forbidden':
      return { message: 'Este caso ya no está a tu nombre.', retry: false }
    case 'network_error':
      return { message: 'No hay conexión. Inténtalo de nuevo.', retry: true }
    default:
      return {
        message: 'No se pudo preparar la sugerencia. Inténtalo de nuevo.',
        retry: error.status >= 500,
      }
  }
}

/** A stored suggestion that failed (`status: failed`, made on its own) → its line. */
export const FAILED_SUGGESTION_MESSAGE = 'El copiloto no pudo preparar la última sugerencia.'

/**
 * The draft into the composer: the draft alone, or after what she had already written (her text
 * is never lost; the backend then measures it as an edited draft).
 */
export function composerTextWithDraft(current: string, draft: string): string {
  const mine = current.trim()
  return mine ? `${mine}\n\n${draft}` : draft
}
