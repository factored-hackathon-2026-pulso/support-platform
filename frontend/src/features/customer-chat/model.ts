/**
 * Customer simulator rules (pure, unit-tested): token claims, chat cache merges
 * (dedupe by id, reconcile optimistic messages by `clientMessageId`, order by
 * sequence), and the copy of the picker and the chat. Contract §4, §5.3.
 */
import { countryName } from '@/features/cases'
import { isApiProblem } from '@/lib/api'
import type {
  CustomerChatCache,
  CustomerConversation,
  CountryCode,
  CustomerConversationResponse,
  CustomerLocale,
  CustomerTurn,
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
  return { conversation: null, turns: [], pending: [] }
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
 * A conversation update. Another case (the customer wrote after the last one
 * closed, so the server opened a new one) starts an empty transcript: the old
 * case's turns are not part of the new conversation.
 */
export function applyConversation(
  cache: CustomerChatCache,
  conversation: CustomerConversation,
): CustomerChatCache {
  if (cache.conversation?.caseId === conversation.caseId) return { ...cache, conversation }
  return { conversation, turns: [], pending: cache.pending }
}

/** GET /customer/conversation result on top of what the cache holds (keeps pending sends). */
export function chatFromResponse(
  response: CustomerConversationResponse,
  previous: CustomerChatCache | undefined,
): CustomerChatCache {
  const base = previous ?? emptyChat()
  if (!response.conversation) return { ...emptyChat(), pending: base.pending }
  return mergeCustomerTurns(applyConversation(base, response.conversation), response.turns)
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
  /** "Daniela · LATAM Bank", "Asistente automático"; null for the customer and notices. */
  author: string | null
  text: string
  createdAt: string
  delivery: 'sent' | 'sending' | 'failed'
  clientMessageId: string | null
}

function bankAuthor(turn: CustomerTurn): string {
  if (turn.authorRole === 'bot') return 'Asistente automático'
  return turn.authorName ? `${turn.authorName} · LATAM Bank` : 'LATAM Bank'
}

export function toChatItems(cache: CustomerChatCache): ChatItem[] {
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

/** Header state line ("Soporte" + this). */
export function conversationStatusLine(conversation: CustomerConversation | null): string {
  if (!conversation) return 'Escribe tu mensaje y te responde una persona del equipo'
  switch (conversation.status) {
    case 'waiting_agent':
      return 'Buscando a una persona del equipo…'
    case 'with_agent':
      return conversation.agentName
        ? `Te atiende ${conversation.agentName} · LATAM Bank`
        : 'Te atiende una persona del equipo · LATAM Bank'
    default:
      return 'Conversación terminada'
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

export function placeLabel(city: string, country: CountryCode): string {
  return `${city}, ${countryName(country)}`
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
