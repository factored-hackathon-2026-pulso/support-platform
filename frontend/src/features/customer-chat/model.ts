/**
 * Customer simulator rules (pure, unit-tested): token claims, chat cache merges
 * (dedupe by id, reconcile optimistic messages by `clientMessageId`, order by
 * sequence), the switch to a new conversation after a close, past conversations,
 * and the copy of the picker and the chat. The chat inside the phone frame speaks
 * the customer's language (`es` | `pt`, `customerChatCopy`); the simulator page
 * around it is staff/dev chrome and stays in Spanish. Contract:
 * docs/platform/api/slice-2-case-lifecycle.md §6, §9.6.
 */
import type { StatusAppearance } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { isApiProblem } from '@/lib/api'
import type {
  CaseRating,
  CustomerChatCache,
  CustomerConversation,
  CustomerConversationResponse,
  CustomerConversationSummary,
  CountryCode,
  CustomerLocale,
  CustomerTurn,
  DemoCustomer,
  Language,
  PendingCustomerMessage,
} from './types'

// ── Token ───────────────────────────────────────────────────────────────────

export const CUSTOMER_TOKEN_AUDIENCE = 'cc-customer'

export interface CustomerTokenClaims {
  customerId: string
  /** Epoch ms, or null when the token carries no expiry. */
  expiresAt: number | null
}

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Reads who the stored customer token is for (`sub`) and when it expires (`exp`),
 * so a reload restores the chat. Not a security check (the server verifies the
 * signature on every call): a token that is malformed, for another audience or
 * expired at `now` returns null and the simulator goes back to the picker.
 */
export function decodeCustomerToken(token: string, now: number): CustomerTokenClaims | null {
  const segment = token.split('.')[1]
  if (!segment) return null
  let claims: unknown
  try {
    claims = JSON.parse(decodeBase64Url(segment))
  } catch {
    return null
  }
  if (typeof claims !== 'object' || claims === null) return null
  const { sub, exp, aud } = claims as Record<string, unknown>
  if (typeof sub !== 'string' || !sub.startsWith('CUS-')) return null
  const audiences = Array.isArray(aud) ? aud : [aud]
  if (aud !== undefined && !audiences.includes(CUSTOMER_TOKEN_AUDIENCE)) return null
  const expiresAt = typeof exp === 'number' ? exp * 1000 : null
  if (expiresAt !== null && expiresAt <= now) return null
  return { customerId: sub, expiresAt }
}

// ── Chat cache ──────────────────────────────────────────────────────────────

export function emptyChat(): CustomerChatCache {
  return { conversation: null, turns: [], pending: [], pastConversationCount: 0, ended: [] }
}

/** Dedupe by id, keep sequence order, drop the pending messages these turns confirm. */
export function mergeCustomerTurns(
  cache: CustomerChatCache,
  incoming: readonly CustomerTurn[],
): CustomerChatCache {
  const known = new Set(cache.turns.map((turn) => turn.id))
  const fresh = new Map<string, CustomerTurn>()
  for (const turn of incoming) if (!known.has(turn.id)) fresh.set(turn.id, turn)
  const confirmed = new Set(
    incoming.map((turn) => turn.clientMessageId).filter((id): id is string => id !== null),
  )
  const pending = cache.pending.filter((m) => !confirmed.has(m.clientMessageId))
  if (fresh.size === 0 && pending.length === cache.pending.length) return cache
  const turns = fresh.size
    ? [...cache.turns, ...fresh.values()].sort((a, b) => a.sequence - b.sequence)
    : cache.turns
  return { ...cache, turns, pending }
}

/**
 * True when `incoming` (another case) should replace the cached conversation:
 * nothing cached yet, or it opened later. A late update of an older case (its
 * close arriving after the new one opened) must never switch the chat back.
 */
export function isNewerConversation(
  incoming: Pick<CustomerConversation, 'caseId' | 'openedAt'>,
  current: Pick<CustomerConversation, 'caseId' | 'openedAt'> | null,
): boolean {
  if (!current) return true
  if (incoming.caseId === current.caseId) return true
  return new Date(incoming.openedAt).getTime() >= new Date(current.openedAt).getTime()
}

/**
 * A conversation update. Same case: patch it. Another, newer case (the customer
 * wrote after the last one closed, so the server opened a new one): the new
 * conversation starts an empty transcript, and the closed one becomes a past
 * block right above it, with its turns (contract §9.6). An older case is ignored.
 */
export function applyConversation(
  cache: CustomerChatCache,
  conversation: CustomerConversation,
): CustomerChatCache {
  const current = cache.conversation
  if (current?.caseId === conversation.caseId) return { ...cache, conversation }
  if (!isNewerConversation(conversation, current)) return cache
  const keep = current !== null && current.status === 'closed'
  const ended =
    keep && !cache.ended.some((past) => past.conversation.caseId === current.caseId)
      ? [...cache.ended, { conversation: current, turns: cache.turns }]
      : cache.ended
  return {
    conversation,
    turns: [],
    pending: cache.pending,
    pastConversationCount: cache.pastConversationCount + (ended.length - cache.ended.length),
    ended,
  }
}

/** GET /customer/conversation result on top of what the cache holds (keeps pending sends). */
export function chatFromResponse(
  response: CustomerConversationResponse,
  previous: CustomerChatCache | undefined,
): CustomerChatCache {
  const base = previous ?? emptyChat()
  if (!response.conversation) {
    return {
      ...emptyChat(),
      pending: base.pending,
      pastConversationCount: response.pastConversationCount,
    }
  }
  const merged = mergeCustomerTurns(applyConversation(base, response.conversation), response.turns)
  // The server count is the truth once it answers (it already includes what ended here).
  return merged.pastConversationCount === response.pastConversationCount
    ? merged
    : { ...merged, pastConversationCount: response.pastConversationCount }
}

export function isSameCase(cache: CustomerChatCache | undefined, caseId: string | null): boolean {
  return Boolean(caseId) && cache?.conversation?.caseId === caseId
}

export function addPendingCustomer(
  cache: CustomerChatCache,
  message: PendingCustomerMessage,
): CustomerChatCache {
  const others = cache.pending.filter((m) => m.clientMessageId !== message.clientMessageId)
  return { ...cache, pending: [...others, message] }
}

export function setPendingStatus(
  cache: CustomerChatCache,
  clientMessageId: string,
  status: PendingCustomerMessage['status'],
): CustomerChatCache {
  if (!cache.pending.some((m) => m.clientMessageId === clientMessageId)) return cache
  return {
    ...cache,
    pending: cache.pending.map((m) =>
      m.clientMessageId === clientMessageId ? { ...m, status } : m,
    ),
  }
}

// ── What the chat shows ─────────────────────────────────────────────────────

export type ChatSide = 'customer' | 'bank' | 'notice'

export interface ChatItem {
  /**
   * React key, stable from "Enviando…" to sent: the `clientMessageId` of the
   * customer's own messages (pending or confirmed), else the turn id, so the
   * bubble is updated in place and the live region announces it once.
   */
  key: string
  side: ChatSide
  /** "Daniela · LATAM Bank"; null for the customer and notices. */
  author: string | null
  text: string
  createdAt: string
  delivery: 'sent' | 'sending' | 'failed'
  clientMessageId: string | null
}

function bankAuthor(turn: CustomerTurn): string {
  return turn.authorName ? `${turn.authorName} · LATAM Bank` : 'LATAM Bank'
}

/** Customer bubbles right, the analyst left (first name), platform notices centred. */
export function toChatItems(cache: Pick<CustomerChatCache, 'turns' | 'pending'>): ChatItem[] {
  const confirmed = cache.turns.map((turn): ChatItem => {
    const side: ChatSide =
      turn.kind === 'notice' || turn.authorRole === 'system'
        ? 'notice'
        : turn.authorRole === 'customer'
          ? 'customer'
          : 'bank'
    return {
      key: turn.clientMessageId ?? turn.id,
      side,
      author: side === 'bank' ? bankAuthor(turn) : null,
      text: turn.text,
      createdAt: turn.createdAt,
      delivery: 'sent',
      clientMessageId: turn.clientMessageId,
    }
  })
  const pending = cache.pending.map((message): ChatItem => ({
    key: message.clientMessageId,
    side: 'customer',
    author: null,
    text: message.text,
    createdAt: message.createdAt,
    delivery: message.status === 'failed' ? 'failed' : 'sending',
    clientMessageId: message.clientMessageId,
  }))
  return [...confirmed, ...pending]
}

// ── Customer-facing copy (es | pt) ──────────────────────────────────────────

/** Everything the customer reads in the chat, in their own language. */
export interface CustomerChatCopy {
  support: string
  loading: string
  greeting: string
  loadErrorTitle: string
  loadErrorBody: string
  retry: string
  logLabel: string
  messagesLabel: string
  suggestionsLabel: string
  inputLabel: string
  send: string
  you: string
  sending: string
  notSent: string
  pastLoadError: string
  pastBlockLoadError: string
  pastSectionLabel: string
  currentConversation: string
}

const CUSTOMER_CHAT_COPY: Record<Language, CustomerChatCopy> = {
  es: {
    support: 'Soporte',
    loading: 'Cargando…',
    greeting: 'Hola, ¿en qué te podemos ayudar?',
    loadErrorTitle: 'No pudimos cargar la conversación',
    loadErrorBody: 'Revisa tu conexión e inténtalo de nuevo.',
    retry: 'Reintentar',
    logLabel: 'Conversación con soporte',
    messagesLabel: 'Mensajes',
    suggestionsLabel: 'Sugerencias',
    inputLabel: 'Escribe tu mensaje',
    send: 'Enviar',
    you: 'Tú',
    sending: 'Enviando…',
    notSent: 'No se envió',
    pastLoadError: 'No pudimos cargar las conversaciones anteriores.',
    pastBlockLoadError: 'No pudimos cargar esta conversación.',
    pastSectionLabel: 'Conversaciones anteriores',
    currentConversation: 'Conversación actual',
  },
  pt: {
    support: 'Suporte',
    loading: 'Carregando…',
    greeting: 'Olá, como podemos ajudar?',
    loadErrorTitle: 'Não foi possível carregar a conversa',
    loadErrorBody: 'Verifique sua conexão e tente de novo.',
    retry: 'Tentar de novo',
    logLabel: 'Conversa com o suporte',
    messagesLabel: 'Mensagens',
    suggestionsLabel: 'Sugestões',
    inputLabel: 'Escreva sua mensagem',
    send: 'Enviar',
    you: 'Você',
    sending: 'Enviando…',
    notSent: 'Não enviada',
    pastLoadError: 'Não foi possível carregar as conversas anteriores.',
    pastBlockLoadError: 'Não foi possível carregar esta conversa.',
    pastSectionLabel: 'Conversas anteriores',
    currentConversation: 'Conversa atual',
  },
}

export function customerChatCopy(language: Language): CustomerChatCopy {
  return CUSTOMER_CHAT_COPY[language] ?? CUSTOMER_CHAT_COPY.es
}

/** `lang` of the chat frame, so assistive tech reads it in the customer's language. */
export function chatLang(language: Language): string {
  return language === 'pt' ? 'pt-BR' : 'es'
}

/** Header state line ("Soporte" / "Suporte" + this). */
export function conversationStatusLine(
  conversation: CustomerConversation | null,
  language: Language,
): string {
  const pt = language === 'pt'
  if (!conversation) {
    return pt
      ? 'Escreva sua mensagem e uma pessoa da equipe vai te atender'
      : 'Escribe tu mensaje y te responde una persona del equipo'
  }
  switch (conversation.status) {
    case 'waiting_agent':
      return pt ? 'Procurando uma pessoa da equipe…' : 'Buscando a una persona del equipo…'
    case 'with_agent': {
      const who = conversation.agentName ?? (pt ? 'uma pessoa da equipe' : 'una persona del equipo')
      return pt ? `Você está falando com ${who} · LATAM Bank` : `Te atiende ${who} · LATAM Bank`
    }
    default:
      return pt ? 'Conversa encerrada' : 'Conversación terminada'
  }
}

/**
 * Chips to offer. The server already sends the right set per customer: openers
 * for a new customer, follow-ups in their own voice for an open chat (Joaquín's
 * "Fue a mediados de mes, unos $48.300"), so they show whether the conversation
 * is absent, open or closed. Hidden while a message is being sent (the next
 * chip waits for the previous one), and a chip already sent in the open
 * conversation is not offered again.
 */
export function visibleSuggestions(
  suggestions: readonly string[],
  cache: CustomerChatCache | undefined,
): string[] {
  if (!cache) return []
  if (cache.pending.some((message) => message.status === 'sending')) return []
  const open = cache.conversation !== null && cache.conversation.status !== 'closed'
  if (!open) return [...suggestions]
  const sent = new Set([
    ...cache.turns.filter((turn) => turn.authorRole === 'customer').map((turn) => turn.text.trim()),
    ...cache.pending.map((message) => message.text.trim()),
  ])
  return suggestions.filter((suggestion) => !sent.has(suggestion.trim()))
}

/** Input placeholder: a closed conversation invites a new one (contract §9.6). */
export function inputPlaceholder(
  conversation: CustomerConversation | null,
  language: Language,
): string {
  const pt = language === 'pt'
  if (conversation?.status === 'closed') {
    return pt
      ? 'Escreva para começar uma nova conversa'
      : 'Escribe para empezar una nueva conversación'
  }
  return pt ? 'Escreva aqui' : 'Escribe aquí'
}

/** Muted note above the input while the current conversation is closed. */
export function closedConversationNote(
  conversation: CustomerConversation | null,
  language: Language,
): string | null {
  if (conversation?.status !== 'closed') return null
  return language === 'pt'
    ? 'Esta conversa terminou. Se você escrever, começamos uma nova.'
    : 'Esta conversación terminó. Si escribes, empezamos una nueva.'
}

// ── Past conversations (contract §6, §9.6) ──────────────────────────────────

/**
 * Closed conversations not on screen yet: the server count minus the ones that
 * ended here (already shown as blocks above the current conversation).
 */
export function hiddenPastCount(
  cache: Pick<CustomerChatCache, 'pastConversationCount' | 'ended'>,
): number {
  return Math.max(0, cache.pastConversationCount - cache.ended.length)
}

/** "Ver conversaciones anteriores (3)" / "Ver conversas anteriores (3)", or null for none. */
export function pastConversationsButton(count: number, language: Language): string | null {
  if (count <= 0) return null
  return language === 'pt'
    ? `Ver conversas anteriores (${count})`
    : `Ver conversaciones anteriores (${count})`
}

/**
 * Server list (newest first) → the blocks to render, oldest at the top, without
 * the ones that ended here (they are already on screen).
 */
export function pastBlocks(
  items: readonly CustomerConversationSummary[],
  ended: CustomerChatCache['ended'],
): CustomerConversationSummary[] {
  const shown = new Set(ended.map((past) => past.conversation.caseId))
  return items.filter((item) => !shown.has(item.caseId)).reverse()
}

/** Spanish month abbreviations of `formatDate` → Portuguese. */
const PT_MONTHS: Record<string, string> = {
  ene: 'jan',
  feb: 'fev',
  may: 'mai',
  sep: 'set',
  oct: 'out',
  dic: 'dez',
}

/**
 * "3 mar 2026" in the viewer's zone (`formatDate`); in Portuguese only the
 * month abbreviation changes ("3 fev 2026", "12 dez 2025").
 */
function formatCustomerDate(value: string, language: Language): string {
  const date = formatDate(value)
  if (language !== 'pt') return date
  const [day, month = '', year] = date.split(' ')
  return [day, PT_MONTHS[month] ?? month, year].join(' ')
}

/**
 * "Conversación del 3 mar 2026 · Terminada · Te atendió Daniela" /
 * "Conversa de 3 mar 2026 · Encerrada · Atendida por Daniela".
 */
export function pastBlockTitle(
  conversation: Pick<CustomerConversationSummary, 'openedAt' | 'status' | 'agentName'>,
  language: Language,
): string {
  const pt = language === 'pt'
  const date = formatCustomerDate(conversation.openedAt, language)
  const closed = conversation.status === 'closed'
  const parts = pt
    ? [`Conversa de ${date}`, closed ? 'Encerrada' : 'Em andamento']
    : [`Conversación del ${date}`, closed ? 'Terminada' : 'En curso']
  if (conversation.agentName) {
    parts.push(
      pt ? `Atendida por ${conversation.agentName}` : `Te atendió ${conversation.agentName}`,
    )
  }
  return parts.join(' · ')
}

/** Last visible message of a past conversation (the list's `preview`, or from its turns). */
export function endedPreview(turns: readonly CustomerTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn && turn.kind === 'message') return turn.text
  }
  return null
}

/** Ended here → the same shape as a server list item. */
export function endedSummary(
  past: CustomerChatCache['ended'][number],
): CustomerConversationSummary {
  const { conversation, turns } = past
  return {
    caseId: conversation.caseId,
    status: conversation.status,
    channel: conversation.channel,
    openedAt: conversation.openedAt,
    closedAt: conversation.closedAt,
    agentName: conversation.agentName,
    preview: endedPreview(turns),
  }
}

export const MAX_CUSTOMER_MESSAGE_LENGTH = 4000

export function normalizeCustomerMessage(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_CUSTOMER_MESSAGE_LENGTH) return null
  return trimmed
}

// ── Picker ──────────────────────────────────────────────────────────────────

const LOCALE_LABELS: Record<CustomerLocale, string> = {
  'es-CO': 'Español de Colombia',
  'es-MX': 'Español de México',
  'es-AR': 'Español de Argentina',
  'pt-BR': 'Portugués de Brasil',
}

export function localeLabel(locale: CustomerLocale): string {
  return LOCALE_LABELS[locale] ?? locale
}

const COUNTRY_NAMES: Record<CountryCode, string> = {
  CO: 'Colombia',
  MX: 'México',
  AR: 'Argentina',
  BR: 'Brasil',
}

export function placeLabel(city: string, country: CountryCode): string {
  return `${city}, ${COUNTRY_NAMES[country] ?? country}`
}

/**
 * The picker's conversation status (glyph + word, the staff glyphs): still
 * waiting for a person (dashed ring, nobody has it yet) or open with someone
 * (half pie, in progress); null without an open conversation.
 */
export const PICKER_STATUS: Readonly<Record<'waiting' | 'open', StatusAppearance>> = {
  waiting: { shape: 'dashed', tone: 'warn', label: 'Esperando a una persona', strong: true },
  open: { shape: 'pie-50', tone: 'success', label: 'Conversación abierta' },
}

export function pickerStatus(
  customer: Pick<DemoCustomer, 'openConversation'>,
): StatusAppearance | null {
  const open = customer.openConversation
  if (!open) return null
  return PICKER_STATUS[open.status === 'waiting_agent' ? 'waiting' : 'open']
}

/** "1 conversación anterior", "3 conversaciones anteriores"; null for none. */
export function closedConversationsLine(count: number): string | null {
  if (count <= 0) return null
  return count === 1 ? '1 conversación anterior' : `${count} conversaciones anteriores`
}

export function describeStartFailure(error: unknown): string {
  if (isApiProblem(error, 'not_found')) {
    return 'Ese cliente ya no está disponible para el simulador. Elige otro.'
  }
  if (isApiProblem(error, 'network_error')) {
    return 'No hay conexión con el servidor. Revisa que el backend esté corriendo.'
  }
  return 'No pudimos abrir la sesión del cliente. Inténtalo de nuevo.'
}

// ── Satisfaction survey (slice 7: CSAT 1–4, in the customer's language) ─────

export type CustomerRatingScore = 1 | 2 | 3 | 4

export interface CustomerRatingOption {
  score: CustomerRatingScore
  /** es: Mal · Regular · Bien · Excelente; pt: Ruim · Regular · Bom · Excelente. */
  label: string
  /** A face (`FACT_ICONS`): frown · meh · smile · laugh. */
  icon: 'frown' | 'meh' | 'smile' | 'laugh'
  /** Card colors when picked: 1 danger, 2 warn, 3 good, 4 great. */
  tone: 'danger' | 'warn' | 'good' | 'great'
}

const RATING_WORDS: Record<Language, readonly [string, string, string, string]> = {
  es: ['Mal', 'Regular', 'Bien', 'Excelente'],
  pt: ['Ruim', 'Regular', 'Bom', 'Excelente'],
}
const RATING_ICONS = ['frown', 'meh', 'smile', 'laugh'] as const
const RATING_TONES = ['danger', 'warn', 'good', 'great'] as const

/** The four answers, worst to best, in the customer's language. */
export function ratingOptions(language: Language): CustomerRatingOption[] {
  const words = RATING_WORDS[language] ?? RATING_WORDS.es
  return words.map((label, index) => ({
    score: (index + 1) as CustomerRatingScore,
    label,
    icon: RATING_ICONS[index] ?? 'smile',
    tone: RATING_TONES[index] ?? 'good',
  }))
}

export function customerRatingOption(score: number, language: Language): CustomerRatingOption {
  const options = ratingOptions(language)
  const index = Math.min(4, Math.max(1, Math.round(score))) - 1
  return options[index] ?? (options[0] as CustomerRatingOption)
}

/** What the bottom of the chat shows for the current conversation. */
export type SurveyState = 'ask' | 'rated' | 'none'

/**
 * The survey replaces the composer while the **current** conversation is closed, not
 * rated and not skipped ("Ahora no", remembered per conversation). Once rated the chat
 * shows the thanks pill and the composer. A new conversation (the customer wrote after
 * the close) never asks for the old one.
 */
export function surveyState(
  conversation: Pick<CustomerConversation, 'caseId' | 'status' | 'rating'> | null,
  skipped: ReadonlySet<string>,
): SurveyState {
  if (!conversation || conversation.status !== 'closed') return 'none'
  if (conversation.rating) return 'rated'
  return skipped.has(conversation.caseId) ? 'none' : 'ask'
}

export const RATING_COMMENT_MAX_LENGTH = 500

/** The request body: the comment trimmed, blank → null. */
export function toRatingRequest(
  score: CustomerRatingScore,
  comment: string,
): { score: CustomerRatingScore; comment: string | null } {
  const trimmed = comment.trim()
  return { score, comment: trimmed ? trimmed.slice(0, RATING_COMMENT_MAX_LENGTH) : null }
}

export interface RatingSurveyCopy {
  title: string
  legend: string
  commentLabel: string
  commentPlaceholder: string
  skip: string
  send: string
  pickFirst: string
}

/** "¿Cómo te atendió Daniela?" / "Como foi o atendimento de Daniela?" and the rest. */
export function ratingSurveyCopy(agentName: string | null, language: Language): RatingSurveyCopy {
  if (language === 'pt') {
    return {
      title: `Como foi o atendimento de ${agentName ?? 'nossa equipe'}?`,
      legend: 'Avalie o atendimento',
      commentLabel: 'Quer contar algo mais? (opcional)',
      commentPlaceholder: 'O que podemos melhorar',
      skip: 'Agora não',
      send: 'Enviar',
      pickFirst: 'Escolha uma opção para enviar.',
    }
  }
  return {
    title: `¿Cómo te atendió ${agentName ?? 'nuestro equipo'}?`,
    legend: 'Califica la atención',
    commentLabel: '¿Quieres contarnos algo más? (opcional)',
    commentPlaceholder: 'Qué podemos mejorar o qué te gustó',
    skip: 'Ahora no',
    send: 'Enviar',
    pickFirst: 'Elige una opción para enviar.',
  }
}

/** "¡Gracias! Calificaste: Excelente" / "Obrigado! Você avaliou: Excelente". */
export function ratedThanks(rating: Pick<CaseRating, 'score'>, language: Language): string {
  const { label } = customerRatingOption(rating.score, language)
  return language === 'pt' ? `Obrigado! Você avaliou: ${label}` : `¡Gracias! Calificaste: ${label}`
}

/** A failed send, in the customer's language (already rated / no longer closed: refetch). */
export function describeRatingFailure(error: unknown, language: Language): string {
  const pt = language === 'pt'
  if (isApiProblem(error, 'network_error')) {
    return pt ? 'Sem conexão. Tente de novo.' : 'No hay conexión. Inténtalo de nuevo.'
  }
  return pt
    ? 'Não foi possível enviar sua avaliação. Tente de novo.'
    : 'No pudimos enviar tu calificación. Inténtalo de nuevo.'
}

/** Problems after which the conversation itself changed: refetch it, the survey follows. */
export function ratingFailureRefetches(error: unknown): boolean {
  return (
    isApiProblem(error, 'already_rated') ||
    isApiProblem(error, 'case_not_closed') ||
    isApiProblem(error, 'not_found')
  )
}

/** sessionStorage value of the skipped conversations ("Ahora no") → their case ids. */
export function parseSkippedRatings(raw: string | null): Set<string> {
  if (!raw) return new Set()
  try {
    const value: unknown = JSON.parse(raw)
    return new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

/** Case ids → the stored value (at most the 50 most recent, the simulator is a demo tool). */
export function serializeSkippedRatings(ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids].slice(-50))
}
