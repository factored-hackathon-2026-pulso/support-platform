/**
 * Conversation rules (pure, unit-tested): how turns are merged, ordered and
 * deduplicated (REST pages, realtime echoes and optimistic sends), how each turn
 * is shown, the copy of the header, the composer, "Cómo llegó a ti" and the
 * close dialog. Contract: docs/platform/api/slice-1-cases.md §3–§5.
 */
import { channelPhrase, countryName, isNewerCase, priorityLabel } from '@/features/cases'
import { isApiProblem } from '@/lib/api'
import { formatDateTime, formatDuration, formatTimer } from '@/lib/format'
import type {
  AssignmentReason,
  CaseChannel,
  CaseDetail,
  CaseSummary,
  CloseCaseRequest,
  ContactReason,
  FollowUp,
  Language,
  PendingMessage,
  ReplyBlockedReason,
  ResolutionCode,
  RouteStop,
  TranscriptCache,
  Turn,
  TurnPage,
} from './types'

// ── Transcript cache: merge, dedupe, order ───────────────────────────────────

/** Page size used when catching up after a reconnect or a sequence gap. */
export const CATCH_UP_PAGE_SIZE = 200

export function emptyTranscript(): TranscriptCache {
  return { turns: [], olderCursor: null, contiguousSequence: 0, pending: [] }
}

function bySequence(a: Turn, b: Turn): number {
  return a.sequence - b.sequence
}

/**
 * Moves the gap-free high-water mark up through the held turns (ascending):
 * staff see every sequence of a case, so `from + 1, from + 2…` must all be
 * present; the first missing number stops it.
 */
function advanceContiguous(turns: readonly Turn[], from: number): number {
  let contiguous = from
  for (const turn of turns) {
    if (turn.sequence <= contiguous) continue
    if (turn.sequence !== contiguous + 1) break
    contiguous = turn.sequence
  }
  return contiguous
}

/**
 * Adds turns to the cache: dedupes by id (the same turn arrives through the POST
 * response, the realtime echo and refetches), keeps ascending `sequence`, and
 * drops the pending message each confirmed turn answers (`clientMessageId`).
 * `contiguousSequence` only moves past a turn when every turn before it is held,
 * so a turn merged across a hole (the analyst's own reply confirmed by REST while
 * the socket missed a customer message) never hides the hole from the catch-up.
 * Returns the same object when nothing changes, so React skips the render.
 */
export function mergeTurns(cache: TranscriptCache, incoming: readonly Turn[]): TranscriptCache {
  const known = new Set(cache.turns.map((turn) => turn.id))
  const fresh = incoming.filter((turn) => !known.has(turn.id))
  const confirmedIds = new Set(
    incoming.map((turn) => turn.clientMessageId).filter((id): id is string => id !== null),
  )
  const pending = cache.pending.filter((message) => !confirmedIds.has(message.clientMessageId))
  if (fresh.length === 0 && pending.length === cache.pending.length) return cache

  const unique = new Map<string, Turn>()
  for (const turn of fresh) unique.set(turn.id, turn)
  const turns = fresh.length ? [...cache.turns, ...unique.values()].sort(bySequence) : cache.turns
  const contiguousSequence = advanceContiguous(turns, cache.contiguousSequence)
  return { ...cache, turns, contiguousSequence, pending }
}

/**
 * First page (latest turns) on top of whatever the cache already holds. The page
 * is a gap-free run that ends at the newest turn; what comes before it is older
 * history, reached through `olderCursor` ("Cargar mensajes anteriores"), not a
 * hole to catch up on.
 */
export function transcriptFromPage(page: TurnPage, previous?: TranscriptCache): TranscriptCache {
  const base = previous ?? emptyTranscript()
  const first = page.items[0]
  const floor = first ? first.sequence - 1 : 0
  return mergeTurns(
    {
      ...base,
      olderCursor: base.olderCursor ?? page.olderCursor,
      contiguousSequence: Math.max(base.contiguousSequence, floor),
    },
    page.items,
  )
}

/** "Cargar mensajes anteriores": merge an older page and move the cursor back. */
export function mergeOlderPage(cache: TranscriptCache, page: TurnPage): TranscriptCache {
  return { ...mergeTurns(cache, page.items), olderCursor: page.olderCursor }
}

/**
 * True when `turn` skips sequence numbers after the gap-free part of the cache:
 * a turn was committed while the socket was down or before the first fetch
 * landed. The caller fetches `?afterSequence=contiguousSequence` instead of
 * merging it.
 */
export function hasSequenceGap(cache: TranscriptCache, turn: Turn): boolean {
  return turn.sequence > cache.contiguousSequence + 1 && !cache.turns.some((t) => t.id === turn.id)
}

/** True when the cache holds a turn past a hole (some earlier turn is missing). */
export function hasMissingTurns(cache: TranscriptCache): boolean {
  const last = cache.turns[cache.turns.length - 1]
  return last !== undefined && last.sequence > cache.contiguousSequence
}

export function addPending(cache: TranscriptCache, message: PendingMessage): TranscriptCache {
  const others = cache.pending.filter((m) => m.clientMessageId !== message.clientMessageId)
  return { ...cache, pending: [...others, message] }
}

export function updatePending(
  cache: TranscriptCache,
  clientMessageId: string,
  patch: Partial<Omit<PendingMessage, 'clientMessageId'>>,
): TranscriptCache {
  if (!cache.pending.some((m) => m.clientMessageId === clientMessageId)) return cache
  return {
    ...cache,
    pending: cache.pending.map((m) =>
      m.clientMessageId === clientMessageId ? { ...m, ...patch } : m,
    ),
  }
}

export function removePending(cache: TranscriptCache, clientMessageId: string): TranscriptCache {
  if (!cache.pending.some((m) => m.clientMessageId === clientMessageId)) return cache
  return { ...cache, pending: cache.pending.filter((m) => m.clientMessageId !== clientMessageId) }
}

// ── Case summary updates ─────────────────────────────────────────────────────

/**
 * Patches the case of a cached detail with a fresher summary. A status change also
 * changes what the server computed for the caller (capabilities, closure): the
 * caller then refetches the detail (`needsDetailRefetch`).
 */
export function applySummary(detail: CaseDetail, summary: CaseSummary): CaseDetail {
  if (detail.case.id !== summary.id || !isNewerCase(summary, detail.case)) return detail
  return { ...detail, case: summary }
}

export function needsDetailRefetch(detail: CaseDetail, summary: CaseSummary): boolean {
  return (
    detail.case.id === summary.id &&
    isNewerCase(summary, detail.case) &&
    (summary.status !== detail.case.status ||
      summary.assignedAnalystId !== detail.case.assignedAnalystId)
  )
}

/**
 * Read cursor to send with POST /read, or null when there is nothing to mark:
 * only the assignee marks, and only a new case or unread customer messages.
 */
export function readTarget(summary: CaseSummary, meId: string): number | null {
  if (summary.assignedAnalystId !== meId || summary.lastSequence <= 0) return null
  if (summary.status === 'closed') return null
  if (summary.status === 'assigned' || summary.unreadCount > 0) return summary.lastSequence
  return null
}

// ── How each turn is shown ───────────────────────────────────────────────────

export type TranscriptVariant = 'customer' | 'own' | 'analyst' | 'bot' | 'routing' | 'notice'

export interface TranscriptItem {
  /**
   * React key, stable from "Enviando…" to sent: the `clientMessageId` of the
   * analyst's own messages (pending or confirmed), else the turn id. The bubble
   * is updated in place, so the transcript live region never announces it twice.
   */
  key: string
  variant: TranscriptVariant
  text: string
  /** Who wrote it ("Tú", the customer, "Árbol de decisión"); null for banners and notes. */
  author: string | null
  createdAt: string
  sequence: number | null
  /** Staff-only turn (never reaches the customer). */
  staffOnly: boolean
  delivery: 'sent' | 'sending' | 'failed'
  error: string | null
  retryable: boolean
  clientMessageId: string | null
}

const BOT_LABELS: Partial<Record<Turn['authorRole'], string>> = {
  judge: 'Juez de entrada',
  tree: 'Árbol de decisión',
  ai_agent: 'Agente de IA',
  copilot: 'Copiloto',
}

export function turnVariant(turn: Turn, meId: string): TranscriptVariant {
  if (turn.kind === 'routing') return 'routing'
  if (turn.kind === 'notice') return 'notice'
  switch (turn.authorRole) {
    case 'customer':
      return 'customer'
    case 'analyst':
      return turn.authorId === meId ? 'own' : 'analyst'
    case 'system':
      return 'notice'
    default:
      return 'bot'
  }
}

export function turnAuthor(turn: Turn, variant: TranscriptVariant): string | null {
  switch (variant) {
    case 'own':
      return 'Tú'
    case 'customer':
      return turn.authorName ?? 'Cliente'
    case 'analyst':
      return turn.authorName ?? 'Analista'
    case 'bot':
      return turn.authorName ?? BOT_LABELS[turn.authorRole] ?? 'Asistente automático'
    default:
      return null
  }
}

/** Confirmed turns in sequence order, then the pending messages in the order they were sent. */
export function toTranscriptItems(cache: TranscriptCache, meId: string): TranscriptItem[] {
  const confirmed = cache.turns.map((turn): TranscriptItem => {
    const variant = turnVariant(turn, meId)
    return {
      key: turn.clientMessageId ?? turn.id,
      variant,
      text: turn.text,
      author: turnAuthor(turn, variant),
      createdAt: turn.createdAt,
      sequence: turn.sequence,
      staffOnly: turn.audience === 'staff',
      delivery: 'sent',
      error: null,
      retryable: false,
      clientMessageId: turn.clientMessageId,
    }
  })
  const pending = cache.pending.map((message): TranscriptItem => ({
    key: message.clientMessageId,
    variant: 'own',
    text: message.text,
    author: 'Tú',
    createdAt: message.createdAt,
    sequence: null,
    staffOnly: false,
    delivery: message.status === 'failed' ? 'failed' : 'sending',
    error: message.error,
    retryable: message.retryable,
    clientMessageId: message.clientMessageId,
  }))
  return [...confirmed, ...pending]
}

/** Label of a centred note: staff-only notes vs notices the customer also saw. */
export function noticeLabel(item: TranscriptItem): string {
  return item.staffOnly ? 'Nota interna' : 'Aviso al cliente'
}

// ── Header, layouts, call bar ────────────────────────────────────────────────

export type ConversationLayout = 'chat' | 'call' | 'email'

export function conversationLayout(channel: CaseChannel): ConversationLayout {
  if (channel === 'phone') return 'call'
  if (channel === 'email') return 'email'
  return 'chat'
}

function entryLabel(detail: CaseDetail): string | null {
  return detail.routing.stops.find((stop) => stop.kind === 'entry')?.label ?? null
}

/**
 * Header meta line after the topic: "Colombia · Barranquilla · chat web · prioridad media",
 * "Colombia · Medellín · chat web · en portugués", "México · reclamo por la CONDUSEF · prioridad baja".
 */
export function caseHeaderMeta(detail: CaseDetail): string {
  const { case: summary, customer } = detail
  const last =
    summary.language === 'pt' ? 'en portugués' : priorityLabel(summary.priority).toLowerCase()
  const entry = entryLabel(detail)
  if (summary.origin === 'regulator') {
    const via = entry ? `reclamo por la ${entry}` : 'reclamo de un regulador'
    return [countryName(customer.country), via, last].join(' · ')
  }
  return [countryName(customer.country), customer.city, channelPhrase(summary.channel), last].join(
    ' · ',
  )
}

/**
 * Short case number for the header ("CASE-…0103", "CASE-…F2BC"): the full
 * 31-character id would push the meta line (country, channel, "en portugués")
 * out of view. The full id stays in the tooltip, the accessible name and "Copiar".
 */
export function shortCaseId(id: string): string {
  const dash = id.indexOf('-')
  if (id.length <= 14 || dash < 0) return id
  return `${id.slice(0, dash + 1)}…${id.slice(-4)}`
}

export interface CallBarState {
  state: string
  tone: 'success' | 'callout' | 'neutral'
  /** "04:06" while in a call; null otherwise. */
  timer: string | null
  /** "Entrante · el IVR verificó su identidad" / "Saliente · reclamo por la CONDUSEF". */
  kind: string
}

export function callBarState(detail: CaseDetail, now: number): CallBarState {
  const { case: summary, channelIdentity } = detail
  const entry = entryLabel(detail)
  const outbound = channelIdentity.kind === 'outbound_call'
  const kind = outbound
    ? summary.origin === 'regulator' && entry
      ? `Saliente · reclamo por la ${entry}`
      : 'Saliente'
    : channelIdentity.verified
      ? `Entrante · ${entry ? `el ${entry}` : 'el canal'} verificó su identidad`
      : 'Entrante'
  if (summary.status === 'in_call' && summary.liveSince) {
    const seconds = (now - new Date(summary.liveSince).getTime()) / 1000
    return { state: 'En llamada', tone: 'success', timer: formatTimer(seconds), kind }
  }
  if (summary.status === 'to_call')
    return { state: 'Por llamar', tone: 'callout', timer: null, kind }
  if (summary.status === 'closed')
    return { state: 'Caso cerrado', tone: 'neutral', timer: null, kind }
  return { state: 'Llamada terminada', tone: 'neutral', timer: null, kind }
}

/** Offset of a call line from the start of the call ("02:07"). */
export function callOffset(createdAt: string, startedAt: string): string {
  return formatTimer((new Date(createdAt).getTime() - new Date(startedAt).getTime()) / 1000)
}

/** First meaningful line of an e-mail (skips greetings), for collapsed older mails. */
export function emailSnippet(body: string): string {
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.find((line) => !/^(hola|buenas|buenos)\b/i.test(line)) ?? lines[0] ?? ''
}

// ── Composer ────────────────────────────────────────────────────────────────

export const MAX_MESSAGE_LENGTH = 4000

export const REPLY_BLOCKED_COPY: Record<ReplyBlockedReason, string> = {
  not_assignee: 'Solo la persona asignada puede escribir en este caso.',
  closed: 'Este caso está cerrado. Si el cliente vuelve a escribir, se abre un caso nuevo.',
  channel_not_supported:
    'Por ahora solo el chat funciona en vivo. Llamadas y correo llegan en una próxima entrega.',
}

/** Text to send, or null when there is nothing to send (blank) or it is too long. */
export function normalizeMessage(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) return null
  return trimmed
}

export interface SendFailure {
  message: string
  /** Re-posting the same clientMessageId can succeed (network, 5xx). */
  retryable: boolean
}

export function describeSendFailure(error: unknown): SendFailure {
  if (isApiProblem(error)) {
    switch (error.code) {
      case 'case_closed':
        return { message: 'No se envió: el caso ya está cerrado.', retryable: false }
      case 'channel_not_supported':
        return {
          message: 'No se envió: por ahora solo puedes escribir en chats.',
          retryable: false,
        }
      case 'case_not_assigned':
      case 'forbidden':
        return { message: 'No se envió: este caso ya no está asignado a ti.', retryable: false }
      case 'idempotency_conflict':
        return { message: 'No se envió: ese mensaje ya se envió con otro texto.', retryable: false }
      case 'validation_error':
        return {
          message: 'No se envió: el mensaje está vacío o pasa de 4.000 caracteres.',
          retryable: false,
        }
      default:
        break
    }
  }
  return { message: 'No se envió', retryable: true }
}

export function describeCaseLoadFailure(error: unknown): { title: string; description: string } {
  if (isApiProblem(error, 'case_not_assigned') || isApiProblem(error, 'forbidden')) {
    return {
      title: 'Este caso no está asignado a ti',
      description: 'Solo la persona asignada y las supervisoras pueden verlo.',
    }
  }
  if (isApiProblem(error, 'not_found')) {
    return { title: 'No encontramos este caso', description: 'Revisa el número o elige otro caso.' }
  }
  return {
    title: 'No pudimos cargar la conversación',
    description: 'Revisa tu conexión e inténtalo de nuevo.',
  }
}

// ── "Cómo llegó a ti" ───────────────────────────────────────────────────────

const LANGUAGE_NAMES: Record<Language, string> = { es: 'español', pt: 'portugués' }

const INPUT_LABELS: Record<string, string> = {
  customers: 'su ficha',
  transactions: 'sus movimientos',
  complaints: 'sus reclamos',
  interactions: 'sus contactos anteriores',
  products: 'sus productos',
  digital_events: 'su actividad digital',
  turn: 'la conversación',
}

const TIER_NAMES: Record<string, { title: string; short: string }> = {
  judge: { title: 'Juez de entrada', short: 'juez' },
  tree: { title: 'Árbol de decisión', short: 'árbol' },
  ai_agent: { title: 'Agente de IA', short: 'agente de IA' },
  human: { title: 'Persona', short: 'persona' },
  supervisor: { title: 'Supervisora', short: 'supervisora' },
}

/** Lower-cases the first letter of a label unless it is an acronym ("IVR", "CONDUSEF"). */
function lowerFirst(text: string): string {
  const [first = '', second = ''] = text
  return second && second === second.toUpperCase() && second !== second.toLowerCase()
    ? text
    : first.toLowerCase() + text.slice(1)
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Spanish list: "a", "a y b", "a, b y c". */
export function joinSpanish(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/** "Esperó 2 min 13 s." style wait. */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  if (s >= 3600) return formatDuration(s / 60)
  const rest = s % 60
  return rest ? `${Math.floor(s / 60)} min ${rest} s` : `${s / 60} min`
}

function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] ?? 'otra persona'
}

/** Short name of a stop in the one-line route ("juez", "agente de disputas", "tú"). */
function stopShortName(stop: RouteStop, meId: string): string {
  switch (stop.kind) {
    case 'tier':
      return stop.label ? lowerFirst(stop.label) : (TIER_NAMES[stop.tier ?? '']?.short ?? 'nivel')
    case 'assignee':
      return stop.staffId === meId ? 'tú' : firstName(stop.label)
    default:
      return stop.label ? lowerFirst(stop.label) : stop.kind === 'queue' ? 'cola' : 'entrada'
  }
}

/** "Juez → árbol → agente de IA → tú", "IVR → cola de disputas → tú". */
export function routeLine(stops: readonly RouteStop[], meId: string): string {
  if (stops.length === 0) return 'Sin recorrido registrado'
  return upperFirst(stops.map((stop) => stopShortName(stop, meId)).join(' → '))
}

export interface RouteStepView {
  key: string
  title: string
  lines: string[]
  /** The last stop (whoever has the case now) is drawn in ink. */
  current: boolean
}

const OUTCOME_COPY: Record<string, string> = {
  abstained: 'Pasó el caso sin atenderlo.',
  handed_off: 'Atendió una parte y pasó el caso.',
  mitigated: 'Atendió una parte y pasó el caso.',
  resolved: 'Lo resolvió.',
}

function stopTitle(stop: RouteStop, meId: string): string {
  switch (stop.kind) {
    case 'tier':
      return stop.label ?? TIER_NAMES[stop.tier ?? '']?.title ?? 'Nivel automático'
    case 'assignee':
      return stop.staffId === meId ? 'Tú' : (stop.label ?? 'Persona asignada')
    case 'queue':
      return stop.label ?? 'Cola'
    default:
      return stop.label ?? 'Entrada'
  }
}

/**
 * Policy rule ids (docs/policies.md, "de dónde sale cada regla") → the rule
 * number analysts know. Only rules that can route or assign a case are listed.
 */
const POLICY_RULE_NUMBERS: Record<string, number> = {
  R1: 1,
  R3: 2,
  H1: 3,
  R2: 4,
  B1: 5,
  AP1: 6,
  L1: 7,
  A1: 8,
  R4: 10,
  H2: 10,
  A2: 11,
}

/** " (regla 3)" when the server recorded the rule behind the step, else "". */
function ruleSuffix(policyRuleId: string | null): string {
  const number = policyRuleId ? POLICY_RULE_NUMBERS[policyRuleId] : undefined
  return number ? ` (regla ${number})` : ''
}

/**
 * Why the case reached the viewer, from what the server recorded on the
 * assignment (`reasonCode` = `AssignmentReason`, `policyRuleId`), never guessed:
 * an outbound follow-up is not "you are available and speak Spanish".
 */
function assignedToMeLine(stop: RouteStop, detail: CaseDetail): string {
  const rule = ruleSuffix(stop.policyRuleId)
  switch (stop.reasonCode as AssignmentReason | null) {
    case 'language_least_loaded':
    case 'queue_drained':
      return `Te llegó porque estás disponible y hablas ${LANGUAGE_NAMES[detail.case.language]}${rule}.`
    case 'outbound_followup':
      return `Te lo asignaron para llamar al cliente: seguimiento saliente${rule}.`
    default:
      return `Te lo asignaron${rule}.`
  }
}

function stopLines(stop: RouteStop, detail: CaseDetail, meId: string): string[] {
  if (stop.kind === 'tier') {
    if (stop.summary) return [stop.summary]
    if (stop.outcome === 'abstained' && stop.reasonCode === 'component_not_connected') {
      return ['Todavía no hay uno conectado: pasó el caso sin atenderlo.']
    }
    return [OUTCOME_COPY[stop.outcome ?? ''] ?? 'Pasó el caso.']
  }
  if (stop.kind === 'queue') {
    const lines = stop.summary ? [stop.summary] : []
    if (stop.waitedSeconds !== null) lines.push(`Esperó ${formatWait(stop.waitedSeconds)}.`)
    return lines.length ? lines : ['Esperó en la cola.']
  }
  if (stop.kind === 'assignee') {
    const since = `Desde el ${formatDateTime(stop.occurredAt, { withYear: false })}.`
    if (stop.summary) return [stop.summary, since]
    if (stop.staffId !== meId) return [`Asignado a ${stop.label ?? 'otra persona'}.`, since]
    return [assignedToMeLine(stop, detail), since]
  }
  return stop.summary ? [stop.summary] : []
}

export function routeSteps(detail: CaseDetail, meId: string): RouteStepView[] {
  const { stops } = detail.routing
  return stops.map((stop, index) => ({
    key: `${index}-${stop.kind}-${stop.occurredAt}`,
    title: stopTitle(stop, meId),
    lines: stopLines(stop, detail, meId),
    current: index === stops.length - 1,
  }))
}

/** "Usaron su ficha y sus movimientos." / "Ningún nivel automático leyó datos del cliente." */
export function inputsSentence(inputsUsed: readonly string[]): string {
  if (inputsUsed.length === 0) return 'Ningún nivel automático leyó datos del cliente.'
  return `Usaron ${joinSpanish(inputsUsed.map((name) => INPUT_LABELS[name] ?? name))}.`
}

// ── Close dialog ────────────────────────────────────────────────────────────

/** "Motivo del contacto", in canvas order. */
export const CONTACT_REASON_OPTIONS: ReadonlyArray<{ value: ContactReason; label: string }> = [
  { value: 'Transaccional', label: 'Transaccional' },
  { value: 'Queja', label: 'Queja' },
  { value: 'Producto', label: 'Producto' },
  { value: 'Técnico', label: 'Técnico' },
  { value: 'Comercial', label: 'Comercial' },
  { value: 'Retención', label: 'Retención' },
]

export const FOLLOW_UP_OPTIONS: ReadonlyArray<{ value: FollowUp; label: string }> = [
  { value: 'tomorrow', label: 'Mañana' },
  { value: 'in_two_days', label: 'En 2 días' },
  { value: 'none', label: 'Sin seguimiento' },
]

/** "Qué se hizo": the five canvas phrases → `ResolutionCode`. */
export const RESOLUTION_OPTIONS: ReadonlyArray<{ value: ResolutionCode; label: string }> = [
  {
    value: 'escalated_to_area',
    label: 'Se escaló a área correspondiente y se aplicó la solución definitiva.',
  },
  {
    value: 'correction',
    label: 'Se verificó la información y se procedió con la corrección solicitada.',
  },
  {
    value: 'adjustment',
    label: 'Se revisó el caso y se realizó el ajuste correspondiente en la cuenta del cliente.',
  },
  {
    value: 'compensation',
    label: 'Se otorgó compensación al cliente por las molestias ocasionadas.',
  },
  {
    value: 'explained',
    label: 'Se brindó explicación detallada al cliente y se resolvió la situación.',
  },
]

export interface CloseCaseForm {
  /** null until the analyst picks Resuelto / Sin resolver. */
  resolved: boolean | null
  contactReason: ContactReason
  /** '' = not chosen (optional). */
  resolutionCode: ResolutionCode | ''
  followUp: FollowUp
  sendCsatSurvey: boolean
}

export const INITIAL_CLOSE_FORM: CloseCaseForm = {
  resolved: null,
  contactReason: 'Transaccional',
  resolutionCode: '',
  followUp: 'tomorrow',
  sendCsatSurvey: true,
}

export type CloseFormErrors = Partial<Record<keyof CloseCaseForm, string>>

export function validateCloseForm(form: CloseCaseForm): CloseFormErrors {
  return form.resolved === null ? { resolved: 'Elige si quedó resuelto o sin resolver.' } : {}
}

export function toCloseRequest(form: CloseCaseForm): CloseCaseRequest {
  return {
    resolved: form.resolved ?? false,
    contactReason: form.contactReason,
    resolutionCode: form.resolutionCode || null,
    followUp: form.followUp,
    sendCsatSurvey: form.sendCsatSurvey,
  }
}

export function describeCloseFailure(error: unknown): string {
  if (isApiProblem(error, 'case_closed')) return 'Este caso ya estaba cerrado.'
  if (isApiProblem(error, 'invalid_transition')) {
    return 'Este caso no se puede cerrar en su estado actual.'
  }
  if (isApiProblem(error, 'case_not_assigned')) return 'Este caso ya no está asignado a ti.'
  return 'No pudimos cerrar el caso. Inténtalo de nuevo.'
}
