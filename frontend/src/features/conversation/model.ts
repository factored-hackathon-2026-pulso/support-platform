/**
 * Conversation rules (pure, unit-tested): how turns are merged, ordered and
 * deduplicated (REST pages, realtime echoes and optimistic sends), how each turn
 * is shown, the copy of the header, "Cómo llegó a ti", the read-only footer,
 * "Casos anteriores" and the close dialog. Contract:
 * docs/platform/api/slice-2-case-lifecycle.md §4, §9.3–§9.5 (transcript rules
 * unchanged from slice-1-cases.md §5).
 */
import type { FactIcon, FactItem, Tone } from '@/components/ui'
import {
  channelPhrase,
  closeReasonLabel,
  countryName,
  inboxStatusMeta,
  isNewerCase,
  priorityLabel,
  ratingOption,
  slaFact,
  type CaseRating,
  type CloseReason,
} from '@/features/cases/core'
import { isApiProblem } from '@/lib/api'
import { formatDate, formatDateTime, formatDuration, formatTime } from '@/lib/format'
import type {
  CaseClosure,
  CaseDetail,
  CaseHistoryItem,
  CaseSummary,
  CloseCaseRequest,
  Language,
  PendingMessage,
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

/**
 * `customer` left; `own` (the viewer) right in ink; `analyst` another analyst
 * (e.g. Julián in a history case) right in ink-2; `routing` the centred staff-only
 * assignment banner; `notice` a centred muted note.
 */
export type TranscriptVariant = 'customer' | 'own' | 'analyst' | 'routing' | 'notice'

export interface TranscriptItem {
  /**
   * React key, stable from "Enviando…" to sent: the `clientMessageId` of the
   * analyst's own messages (pending or confirmed), else the turn id. The bubble
   * is updated in place, so the transcript live region never announces it twice.
   */
  key: string
  variant: TranscriptVariant
  text: string
  /** Who wrote it ("Tú", the customer, another analyst); null for banners and notes. */
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

export function turnVariant(turn: Turn, meId: string): TranscriptVariant {
  if (turn.kind === 'routing') return 'routing'
  if (turn.kind === 'notice') return 'notice'
  switch (turn.authorRole) {
    case 'customer':
      return 'customer'
    case 'analyst':
      return turn.authorId === meId ? 'own' : 'analyst'
    default:
      return 'notice'
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

// ── Header ──────────────────────────────────────────────────────────────────

/**
 * Header meta line (contract §9.3): "Colombia · Barranquilla · chat web ·
 * prioridad media"; a Portuguese case ends "· en portugués" instead (rule 3: the
 * only cue outside the transcript that the reply must be in Portuguese).
 */
export function caseHeaderMeta(detail: Pick<CaseDetail, 'case' | 'customer'>): string {
  const { case: summary, customer } = detail
  const last =
    summary.language === 'pt' ? 'en portugués' : priorityLabel(summary.priority).toLowerCase()
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

/** "Casos anteriores (2)": the header button, shown only when there are any. */
export function previousCasesLabel(count: number): string | null {
  return count > 0 ? `Casos anteriores (${count})` : null
}

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? ''
}

// ── Arrival note (people-based assignment only, contract §9.3, slice 3 §8.3) ─

/** "español" / "portugués", as the copy says the case language. */
export const LANGUAGE_NAMES: Record<Language, string> = { es: 'español', pt: 'portugués' }

/**
 * Names of the language queues (team-generated, slice 2 §3.3; the backend sends
 * the same text as `LanguageQueue.label` / `AssignmentOut.queueLabel`). Needed here
 * for a queued case, which has no assignment to carry the label yet.
 */
export const QUEUE_LABEL: Record<Language, string> = {
  es: 'Cola en español',
  pt: 'Cola en portugués',
}

/** What the transcript and the panes allow (slice 3 §8.3). */
export type ConversationMode = 'workspace' | 'supervision'

/** "45 s", "2 min 13 s", "6 min", "1 h 5 min". */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  if (s >= 3600) return formatDuration(s / 60)
  const rest = s % 60
  return rest ? `${Math.floor(s / 60)} min ${rest} s` : `${s / 60} min`
}

/** "la cola en portugués" from the server's "Cola en portugués". */
export function queueInSentence(queueLabel: string | null): string {
  if (!queueLabel) return 'la cola'
  return `la ${queueLabel.charAt(0).toLowerCase()}${queueLabel.slice(1)}`
}

/**
 * The arrival line of the supervisor's read-only case view (slice 3 §8.3):
 * - queued: "Espera en la cola en español desde las 10:47: nadie disponible habla español";
 * - `language_least_loaded`: "Lo atiende Daniela Ríos: le llegó al estar
 *   disponible y hablar portugués (regla 3) · 5 mar, 10:58";
 * - `queue_drained`: "Lo atiende Daniela Ríos: le llegó desde la cola en
 *   portugués tras 6 min · 5 mar, 10:58";
 * - `manual`: "Lo atiende Julián Ortega: se lo pasó Lucía Herrera · 5 mar, 10:58"
 *   ("se lo asignó" from the queue);
 * - closed: "Lo atendió Julián Ortega".
 */
export function supervisionArrivalLine(
  detail: Pick<CaseDetail, 'assignment' | 'case'>,
): string | null {
  const { assignment, case: summary } = detail
  const language = LANGUAGE_NAMES[summary.language]
  if (summary.status === 'queued') {
    return `Espera en ${queueInSentence(QUEUE_LABEL[summary.language])} desde las ${formatTime(summary.openedAt)}: nadie disponible habla ${language}`
  }
  if (!assignment) return null
  if (summary.status === 'closed') return `Lo atendió ${assignment.analystName}`
  const when = formatDateTime(assignment.assignedAt, { withYear: false })
  const who = `Lo atiende ${assignment.analystName}`
  switch (assignment.reason) {
    case 'queue_drained': {
      const waited =
        assignment.waitedSeconds !== null ? ` tras ${formatWait(assignment.waitedSeconds)}` : ''
      return `${who}: le llegó desde ${queueInSentence(assignment.queueLabel ?? QUEUE_LABEL[summary.language])}${waited} · ${when}`
    }
    case 'manual': {
      const verb = assignment.previousAnalystId === null ? 'se lo asignó' : 'se lo pasó'
      return `${who}: ${verb} ${assignment.assignedByName ?? 'supervisión'} · ${when}`
    }
    default: {
      const rule = summary.language === 'pt' ? ' (regla 3)' : ''
      return `${who}: le llegó al estar disponible y hablar ${language}${rule} · ${when}`
    }
  }
}

// ── Read-only footer and closure (contract §9.3) ────────────────────────────

/**
 * "Caso cerrado el 3 mar, 10:15 · Resuelto"; when someone else closed it:
 * "Caso cerrado el 3 mar, 10:15 por Julián Ortega · Resuelto".
 */
export function closureLine(
  closure: Pick<CaseClosure, 'closedAt' | 'closedById' | 'closedByName' | 'reason'>,
  meId?: string,
): string {
  const when = formatDateTime(closure.closedAt, { withYear: false })
  const by =
    meId !== undefined && closure.closedById !== meId && closure.closedByName
      ? ` por ${closure.closedByName}`
      : ''
  return `Caso cerrado el ${when}${by} · ${closeReasonLabel(closure.reason)}`
}

/** "Nota: …" under the closure line, or null without a note. */
export function closureNote(closure: Pick<CaseClosure, 'note'>): string | null {
  const note = closure.note?.trim()
  return note ? `Nota: ${note}` : null
}

/**
 * Footer of the supervisor's read-only case view (slice 3 §8.3), which never
 * has a composer: queued "Vista de supervisión · El caso espera en la cola en
 * español. Asígnalo para que alguien le responda."; open "Vista de supervisión
 * · Solo lectura. Lo atiende {analista}."; closed: the closure line (+ "Nota: …").
 */
export function supervisionFooter(
  detail: Pick<CaseDetail, 'case' | 'closure' | 'assignment'>,
  meId: string,
): string[] {
  const { case: summary, closure, assignment } = detail
  if (closure) {
    const note = closureNote(closure)
    return note ? [closureLine(closure, meId), note] : [closureLine(closure, meId)]
  }
  if (summary.status === 'queued' || !assignment) {
    return [
      `Vista de supervisión · El caso espera en ${queueInSentence(QUEUE_LABEL[summary.language])}. Asígnalo para que alguien le responda.`,
    ]
  }
  return [`Vista de supervisión · Solo lectura. Lo atiende ${assignment.analystName}.`]
}

// ── Composer ────────────────────────────────────────────────────────────────

export const MAX_MESSAGE_LENGTH = 4000

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
      title: 'No tienes acceso a este caso',
      description:
        'Lo ven la persona asignada, las supervisoras y quien atendió antes a este cliente.',
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

// ── "Ficha del cliente" (slice 6 §5: the right panel of the Workspace) ──────
//
// UI rule (slice 6 §4.7): one fact per row (icon + label, a short value), the
// status as a pill, times with a clock; never a dot-joined line or a sentence.

/** Id of the Workspace panel (`aria-controls` of the name button). */
export const CUSTOMER_FILE_PANEL_ID = 'ficha-del-cliente'
/** Id of the name button (the focus returns to it when the panel closes). */
export const CUSTOMER_FILE_TRIGGER_ID = 'ficha-del-cliente-boton'

/** The customer-name button of the slim header: "Ver ficha de Beatriz Salcedo Prieto". */
export function customerFileTriggerLabel(customerName: string): string {
  return `Ver ficha de ${customerName}`
}

/** "Portugués" / "Español": the language of a case or a customer, as a value. */
export function languageName(language: Language): string {
  const name = LANGUAGE_NAMES[language]
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** One row of the file: an icon and a label, then the value (text, a pill or facts). */
export interface FileRow {
  key: string
  icon: FactIcon
  label: string
  text?: string
  mono?: boolean
  /** The case status (or the customer's rating, with its face) as a colored pill. */
  pill?: { label: string; tone: Tone; icon?: FactIcon }
  /** Short facts as the value ("Primera respuesta"). */
  facts?: FactItem[]
}

/** "Cliente": name, city and country, language, customer id (only what the platform has). */
export function customerRows(detail: Pick<CaseDetail, 'customer'>): FileRow[] {
  const { customer } = detail
  return [
    { key: 'name', icon: 'user', label: 'Nombre', text: customer.displayName },
    {
      key: 'place',
      icon: 'map-pin',
      label: 'Ciudad',
      text: `${customer.city}, ${countryName(customer.country)}`,
    },
    { key: 'language', icon: 'languages', label: 'Idioma', text: languageName(customer.language) },
    { key: 'id', icon: 'id', label: 'Id de cliente', text: customer.id, mono: true },
  ]
}

const PRIORITY_VALUE: Record<CaseSummary['priority'], string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
}

/**
 * "Primera respuesta": while pending, the shared SLA level fact (flame or clock);
 * answered, "A tiempo" or "Tarde" and its time; closed unanswered, "Sin respuesta".
 */
export function firstResponseFacts(
  summary: Pick<CaseSummary, 'status' | 'slaDueAt' | 'firstResponseAt'>,
  now: Date | string | number,
): FactItem[] {
  if (summary.firstResponseAt) {
    const met = new Date(summary.firstResponseAt).getTime() <= new Date(summary.slaDueAt).getTime()
    return [
      met
        ? { key: 'result', icon: 'check', text: 'A tiempo', tone: 'success' }
        : { key: 'result', icon: 'alert', text: 'Tarde', tone: 'danger' },
      {
        key: 'at',
        icon: 'clock',
        text: formatDateTime(summary.firstResponseAt, { withYear: false }),
        label: 'Respondió',
        tooltip: 'Respondió',
        tone: 'muted',
      },
    ]
  }
  const sla = slaFact(summary, now)
  return sla ? [sla] : [{ key: 'result', icon: 'alert', text: 'Sin respuesta', tone: 'muted' }]
}

/** "Este caso": number, channel, priority, opened, status pill and the first response. */
export function caseRows(detail: Pick<CaseDetail, 'case'>, now: Date | string | number): FileRow[] {
  const { case: summary } = detail
  const status = inboxStatusMeta(summary)
  return [
    { key: 'id', icon: 'hash', label: 'Número', text: summary.id, mono: true },
    {
      key: 'channel',
      icon: summary.channel === 'app_chat' ? 'smartphone' : 'globe',
      label: 'Canal',
      text: channelName(summary.channel),
    },
    { key: 'priority', icon: 'flag', label: 'Prioridad', text: PRIORITY_VALUE[summary.priority] },
    {
      key: 'opened',
      icon: 'calendar-clock',
      label: 'Abierto',
      text: formatDateTime(summary.openedAt, { withYear: false }),
    },
    {
      key: 'status',
      icon: 'inbox',
      label: 'Estado',
      pill: { label: status.subLabel, tone: status.tone },
    },
    {
      key: 'first-response',
      icon: 'clock',
      label: 'Primera respuesta',
      facts: firstResponseFacts(summary, now),
    },
    ...(summary.status === 'closed' ? [ratingRow(summary.rating)] : []),
  ]
}

/**
 * "Calificación" of a closed case (slice 7): the face and the word as a pill, or
 * "Sin calificar" while the customer has not rated it. Open cases have no row.
 */
export function ratingRow(rating: Pick<CaseRating, 'score'> | null): FileRow {
  if (!rating) {
    return {
      key: 'rating',
      icon: 'smile',
      label: 'Calificación',
      pill: { label: 'Sin calificar', tone: 'closed' },
    }
  }
  const option = ratingOption(rating.score)
  return {
    key: 'rating',
    icon: 'smile',
    label: 'Calificación',
    pill: { label: option.label, tone: option.tone, icon: option.icon },
  }
}

/** "Chat en la app" / "Chat web". */
function channelName(channel: CaseSummary['channel']): string {
  const phrase = channelPhrase(channel)
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/** "Cómo llegó a ti" as structured facts: a heading, its time, one icon row per fact. */
export interface ArrivalFacts {
  heading: string
  /** When it was assigned ("3 oct, 19:23"), on the heading row. */
  time: string | null
  facts: FactItem[]
}

/**
 * The people-based assignment as short icon rows built from the assignment
 * fields, never a sentence:
 * - hers, on arrival: [check] Estabas disponible, [languages] Hablas portugués + "Regla 3";
 * - hers, from the queue: [hourglass] Esperó 14 min, [inbox] Cola en portugués,
 *   [check] Quedaste disponible;
 * - hers, by a supervisor: [users] Asignado por Lucía Herrera (+ [hourglass] the
 *   wait from the queue, or [user] Antes: Julián Ortega on a reassignment);
 * - someone else's (history access): "Quién lo atiende" / "Quién lo atendió":
 *   [user] the analyst (+ [users] Asignado por … when a supervisor chose).
 * No assignment (queued): null.
 */
export function arrivalFacts(
  detail: Pick<CaseDetail, 'assignment' | 'case'>,
  meId: string,
): ArrivalFacts | null {
  const { assignment, case: summary } = detail
  if (!assignment) return null
  const time = formatDateTime(assignment.assignedAt, { withYear: false })
  const by: FactItem | null =
    assignment.reason === 'manual'
      ? {
          key: 'by',
          icon: 'users',
          text: `Asignado por ${assignment.assignedByName ?? 'Supervisión'}`,
        }
      : null
  const waited: FactItem | null =
    assignment.waitedSeconds !== null
      ? { key: 'waited', icon: 'hourglass', text: `Esperó ${formatWait(assignment.waitedSeconds)}` }
      : null
  const keep = (facts: (FactItem | null)[]) =>
    facts.filter((fact): fact is FactItem => fact !== null)

  if (assignment.analystId !== meId) {
    const closed = summary.status === 'closed'
    return {
      heading: closed ? 'Quién lo atendió' : 'Quién lo atiende',
      time,
      facts: keep([
        { key: 'analyst', icon: 'user', text: assignment.analystName },
        closed ? null : by,
      ]),
    }
  }
  const heading = 'Cómo llegó a ti'
  if (assignment.reason === 'manual') {
    const previous = assignment.previousAnalystId
      ? {
          key: 'previous',
          icon: 'user' as const,
          text: `Antes: ${assignment.previousAnalystName ?? 'otra persona'}`,
        }
      : null
    return { heading, time, facts: keep([by, previous ?? waited]) }
  }
  if (assignment.reason === 'queue_drained') {
    const queue = assignment.queueLabel ?? QUEUE_LABEL[summary.language]
    return {
      heading,
      time,
      facts: keep([
        waited,
        { key: 'queue', icon: 'inbox', text: queue },
        { key: 'available', icon: 'check', text: 'Quedaste disponible', tone: 'success' },
      ]),
    }
  }
  return {
    heading,
    time,
    facts: [
      { key: 'available', icon: 'check', text: 'Estabas disponible', tone: 'success' },
      {
        key: 'language',
        icon: 'languages',
        text: `Hablas ${LANGUAGE_NAMES[summary.language]}`,
        ...(summary.language === 'pt' ? { tag: 'Regla 3' } : {}),
      },
    ],
  }
}

/**
 * The workspace read-only footer as facts (slice 6 UI rule): a closed case →
 * the reason (icon + label, drawn by the component), [clock] when, [user] who
 * closed it when it was someone else; someone else's case → [lock] Solo
 * lectura, [user] Lo atiende … . The internal note stays its own line.
 */
export interface FooterFacts {
  reason: CloseReason | null
  facts: FactItem[]
  note: string | null
  /** The customer's rating of the closed case (slice 7): "El cliente calificó: Bien". */
  rating: CaseRating | null
}

export function footerFacts(
  detail: Pick<CaseDetail, 'capabilities' | 'closure' | 'assignment'> & {
    case?: Pick<CaseDetail['case'], 'rating'>
  },
  meId: string,
): FooterFacts | null {
  const { capabilities, closure, assignment } = detail
  if (capabilities.canReply) return null
  if (closure) {
    const facts: FactItem[] = [
      {
        key: 'closed-at',
        icon: 'clock',
        text: formatDateTime(closure.closedAt, { withYear: false }),
        label: 'Cerrado',
        tooltip: 'Cerrado',
      },
    ]
    if (closure.closedById !== meId && closure.closedByName) {
      facts.push({
        key: 'closed-by',
        icon: 'user',
        text: closure.closedByName,
        label: 'Lo cerró',
        tooltip: 'Lo cerró',
      })
    }
    return {
      reason: closure.reason,
      facts,
      note: closureNote(closure),
      rating: detail.case?.rating ?? null,
    }
  }
  const facts: FactItem[] = [{ key: 'read-only', icon: 'lock', text: 'Solo lectura' }]
  if (assignment && assignment.analystId !== meId) {
    facts.push({ key: 'owner', icon: 'user', text: `Lo atiende ${assignment.analystName}` })
  }
  return { reason: null, facts, note: null, rating: null }
}

/**
 * A row of "Casos anteriores" as facts: [calendar] date, the reason (or "Abierto"),
 * [user] who, and (slice 7) the customer's rating as [face] "Calificó: Excelente".
 */
export function historyItemFacts(
  item: Pick<CaseHistoryItem, 'openedAt' | 'status' | 'analystName'> &
    Partial<Pick<CaseHistoryItem, 'rating'>>,
): FactItem[] {
  const rating = item.rating ? ratingOption(item.rating.score) : null
  return [
    { key: 'date', icon: 'calendar', text: formatDate(item.openedAt), label: 'Abierto' },
    ...(item.status === 'closed'
      ? []
      : [{ key: 'open', icon: 'inbox' as const, text: 'Abierto', tone: 'accent' as const }]),
    { key: 'analyst', icon: 'user', text: item.analystName ?? 'Sin asignar' },
    ...(rating
      ? [
          {
            key: 'rating',
            icon: rating.icon,
            text: `Calificó: ${rating.label}`,
            tone: rating.textTone,
          },
        ]
      : []),
  ]
}

/** The quoted comment under the rating pill: “Muy clara…” (none → null). */
export function ratingComment(rating: Pick<CaseRating, 'comment'> | null): string | null {
  return rating?.comment ? `“${rating.comment}”` : null
}

/** "Casos anteriores (2)", the panel section title (also without any: "(0)"). */
export function previousCasesSectionTitle(count: number): string {
  return `Casos anteriores (${count})`
}

// ── "Casos anteriores de este cliente" (contract §4.7, §9.4) ────────────────

/** "Casos anteriores de Patricia". */
export function historySheetTitle(customerName: string): string {
  const first = firstName(customerName)
  return first ? `Casos anteriores de ${first}` : 'Casos anteriores'
}

/** Shown under the list when the server capped it (it returns at most 20). */
export function historyTruncatedNote(shown: number, total: number): string | null {
  return total > shown ? 'Se muestran los 20 más recientes.' : null
}

// ── Close dialog (contract §4.4, §9.5) ──────────────────────────────────────

/** Maximum length of the internal note, after trimming. */
export const CLOSE_NOTE_MAX_LENGTH = 500

/**
 * The notice the customer gets when the case closes, in the case language. It
 * must stay identical to the backend text (contract §3.3); a model test pins it.
 */
export const CLOSED_NOTICE: Record<Language, string> = {
  es: 'La conversación terminó. Si necesitas algo más, escríbenos y te atendemos en una nueva conversación.',
  pt: 'A conversa foi encerrada. Se precisar de algo mais, escreva para nós e abrimos uma nova conversa.',
}

export interface CloseCaseForm {
  /** null until the analyst picks a reason (required). */
  reason: CloseReason | null
  /** Internal note, optional ('' = none). Only staff see it. */
  note: string
}

export const INITIAL_CLOSE_FORM: CloseCaseForm = { reason: null, note: '' }

export type CloseFormErrors = Partial<Record<keyof CloseCaseForm, string>>

export function validateCloseForm(form: CloseCaseForm): CloseFormErrors {
  const errors: CloseFormErrors = {}
  if (form.reason === null) errors.reason = 'Elige un motivo.'
  if (form.note.trim().length > CLOSE_NOTE_MAX_LENGTH) {
    errors.note = 'La nota puede tener hasta 500 caracteres.'
  }
  return errors
}

/** `{ reason, note: trimmed || null }`. Call it only after `validateCloseForm` passed. */
export function toCloseRequest(form: CloseCaseForm & { reason: CloseReason }): CloseCaseRequest {
  return { reason: form.reason, note: form.note.trim() || null }
}

/** "{n}/500" under the note (trimmed length, as the server counts it). */
export function noteCounter(note: string): string {
  return `${note.trim().length}/${CLOSE_NOTE_MAX_LENGTH}`
}

export function describeCloseFailure(error: unknown): string {
  if (isApiProblem(error, 'case_closed')) return 'Este caso ya estaba cerrado.'
  if (isApiProblem(error, 'invalid_transition')) {
    return 'Este caso no se puede cerrar en su estado actual.'
  }
  if (isApiProblem(error, 'case_not_assigned')) {
    return 'Ya no puedes cerrarlo: supervisión pasó este caso a otra persona.'
  }
  if (isApiProblem(error, 'validation_error')) return 'Revisa el motivo y la nota.'
  return 'No pudimos cerrar el caso. Inténtalo de nuevo.'
}
