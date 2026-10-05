/**
 * Conversation rules (pure, unit-tested): how turns are merged, ordered and
 * deduplicated (REST pages, realtime echoes and optimistic sends), how each turn
 * is shown, the copy of the header, "Cómo llegó a ti", the read-only footer,
 * "Casos anteriores" and the close dialog. Contract:
 * docs/platform/api/slice-2-case-lifecycle.md §4, §9.3–§9.5 (transcript rules
 * unchanged from slice-1-cases.md §5).
 */
import type { FactIcon, FactItem, StatusAppearance, Tone } from '@/components/ui'
import {
  caseStatus,
  caseChannel,
  closeReasonLabel,
  channelFact,
  channelLabel,
  countryName,
  isNewerCase,
  casePriority,
  caseType,
  isAttendedEscalation,
  MAX_ESCALATION_TEXT,
  ratingFact,
  ratingOption,
  slaFact,
  type CasePriority,
  type CaseRating,
  type CaseType,
  type CloseReason,
} from '@/features/cases/core'
import { isApiProblem } from '@/lib/api'
import {
  callEventKind,
  callForTime,
  lineOffset,
  unansweredEmailIds,
  type CallEventKind,
} from './channels'
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  formatTime,
  getInitials,
} from '@/lib/format'
import { i18n } from '@/lib/i18n'
import type {
  Call,
  CaseClosure,
  CaseDetail,
  CaseHistoryItem,
  CaseSummary,
  CloseCaseRequest,
  HandoffQuality,
  HandoffReask,
  Escalation,
  Language,
  PendingMessage,
  TranscriptCache,
  Turn,
  TurnPage,
} from './types'

/** Copy comes from the `conversation` catalog, read when a function runs (the UI language then). */
const t = i18n.getFixedT(null, 'conversation')

// ── Transcript cache: merge, dedupe, order ───────────────────────────────────

/** Page size used when catching up after a reconnect or a sequence gap. */
export const CATCH_UP_PAGE_SIZE = 200

/**
 * "Casos anteriores" on its list (`?previous=list`, in the Workspace and the supervisor case
 * view); any other value is the id of the past case whose transcript is open.
 */
export const PREVIOUS_CASES_LIST = 'list'
export type PreviousCasesSelection = typeof PREVIOUS_CASES_LIST | (string & {})

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
      summary.assignedAnalystId !== detail.case.assignedAnalystId ||
      // Slice 12: a call started or ended changes what the caller may do (call, close).
      (summary.activeCallId ?? null) !== (detail.case.activeCallId ?? null))
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
 * assignment banner; `notice` a centred muted note. Slice 12: `line` a call transcript
 * line (time, speaker, text), `call-event` a system line of a call (held, resumed,
 * ended), `note` a staff-only note, `email` one email of the thread.
 */
export type TranscriptVariant =
  | 'customer'
  | 'own'
  | 'analyst'
  | 'assistant'
  | 'routing'
  | 'notice'
  | 'line'
  | 'call-event'
  | 'note'
  | 'email'

/** Who speaks on a call line or wrote an email. */
export type TranscriptSpeaker = 'customer' | 'own' | 'analyst'

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
  /** Call lines and emails: who it is (avatar tone and side). */
  speaker?: TranscriptSpeaker
  /** Call lines and emails: the author's initials for the avatar (never "Tú"). */
  initials?: string
  /** Call lines and events: "02:41" inside the call (or the clock time). */
  time?: string
  /** Call events: which glyph. */
  event?: CallEventKind
  /** Emails: the subject, and whether the customer's email is still unanswered ("Nuevo"). */
  subject?: string | null
  isNew?: boolean
  /** Emails: the newest of the thread (it starts open, the older ones as one line). */
  latest?: boolean
}

export function turnVariant(turn: Turn, meId: string): TranscriptVariant {
  if (turn.kind === 'routing') return 'routing'
  if (turn.kind === 'notice') return 'notice'
  if (turn.kind === 'note') return 'note'
  if (turn.kind === 'email') return 'email'
  if (turn.kind === 'transcript') return turn.authorRole === 'system' ? 'call-event' : 'line'
  switch (turn.authorRole) {
    case 'customer':
      return 'customer'
    case 'analyst':
      return turn.authorId === meId ? 'own' : 'analyst'
    // Slice 19: the virtual assistant's replies (agent-core), before people had the case.
    case 'assistant':
      return 'assistant'
    default:
      return 'notice'
  }
}

function turnSpeaker(turn: Turn, meId: string): TranscriptSpeaker {
  if (turn.authorRole === 'customer') return 'customer'
  return turn.authorId === meId ? 'own' : 'analyst'
}

export function turnAuthor(turn: Turn, variant: TranscriptVariant, meId = ''): string | null {
  switch (variant) {
    case 'own':
      return t('transcript.you')
    case 'customer':
      return turn.authorName ?? t('transcript.customer')
    case 'analyst':
      return turn.authorName ?? t('transcript.analyst')
    case 'assistant':
      // Slice 23c: the server names it in Spanish ("Asistente virtual"); staff read their own.
      return t('transcript.assistant')
    case 'line': {
      // The canvas labels the call's two sides "Cliente" and "Tú".
      const speaker = turnSpeaker(turn, meId)
      if (speaker === 'customer') return t('transcript.customer')
      return speaker === 'own' ? t('transcript.you') : (turn.authorName ?? t('transcript.analyst'))
    }
    case 'note':
    case 'email':
      if (turn.authorRole === 'customer') return turn.authorName ?? t('transcript.customer')
      return turn.authorId === meId
        ? t('transcript.you')
        : (turn.authorName ?? t('transcript.analyst'))
    default:
      return null
  }
}

/** What the transcript needs besides the turns (slice 12): the calls, to time their lines. */
export interface TranscriptContext {
  calls?: readonly Call[]
}

function channelFields(
  turn: Turn,
  variant: TranscriptVariant,
  meId: string,
  context: TranscriptContext,
  unanswered: ReadonlySet<string>,
  lastEmailId: string | null,
): Partial<TranscriptItem> {
  if (variant === 'line' || variant === 'call-event') {
    const call = context.calls ? callForTime(context.calls, turn.createdAt) : null
    const time = call ? lineOffset(call, turn.createdAt) : formatTime(turn.createdAt)
    if (variant === 'call-event') return { time, event: callEventKind(turn.text) }
    const speaker = turnSpeaker(turn, meId)
    return {
      time,
      speaker,
      initials: getInitials(
        turn.authorName ?? t(speaker === 'customer' ? 'transcript.customer' : 'transcript.you'),
      ),
    }
  }
  if (variant === 'email') {
    return {
      speaker: turnSpeaker(turn, meId),
      initials: getInitials(turn.authorName ?? t('transcript.customer')),
      subject: turn.subject,
      isNew: unanswered.has(turn.id),
      latest: turn.id === lastEmailId,
    }
  }
  return {}
}

// ── Staff-only lines (slice 23c) ─────────────────────────────────────────────

/** The facts of a staff-only line (`Turn.staffLine`). */
export type StaffLine = NonNullable<Turn['staffLine']>

const CLOSE_REASONS_KNOWN: readonly CloseReason[] = [
  'resolved',
  'customer_unresponsive',
  'duplicate',
  'out_of_scope',
  'other',
]
const RELEASE_REASONS = [
  'escalated',
  'ended',
  'failed',
  'supervision',
  'customer_request',
  'ai_disabled',
] as const
type ReleaseReason = (typeof RELEASE_REASONS)[number]

function isReleaseReason(value: string | null): value is ReleaseReason {
  return (RELEASE_REASONS as readonly (string | null)[]).includes(value)
}

/**
 * A staff-only line of the transcript written from its facts in the viewer's language
 * ("Asignado a Daniela Ríos porque está disponible y habla español." / "Atribuído a Daniela
 * Ríos porque está disponível e fala espanhol."). `null` when the facts are missing a value
 * this version needs: the turn's stored (Spanish) text is shown instead, as for lines written
 * before 23c. The previous case's closing time is shown in the viewer's zone.
 */
export function staffLineText(line: StaffLine): string | null {
  const text = (key: string): string | null => {
    const value = line.params[key]
    return typeof value === 'string' && value !== '' ? value : null
  }
  const count = (key: string): number | null => {
    const value = line.params[key]
    return typeof value === 'number' ? value : null
  }
  const raw = text('language')
  const language: Language | null = raw === 'es' || raw === 'pt' ? raw : null
  const analyst = text('analyst')
  const supervisor = text('supervisor')
  const previous = text('previous')
  const minutes = count('minutes')
  const paused = text('paused')
  switch (line.kind) {
    case 'assigned_on_arrival':
      return analyst && language ? t(`staffLine.assignedOnArrival.${language}`, { analyst }) : null
    case 'assigned_from_assistant':
      return analyst && language
        ? t(`staffLine.assignedFromAssistant.${language}`, { analyst })
        : null
    case 'queued':
      return language ? t(`staffLine.queued.${language}`) : null
    case 'assigned_from_queue':
      return analyst && language && minutes !== null
        ? t(`staffLine.assignedFromQueue.${language}`, { analyst, minutes })
        : null
    case 'assigned_by_supervision': {
      if (!supervisor || !analyst || !language || minutes === null) return null
      const values = { supervisor, analyst, minutes }
      return paused
        ? t(`staffLine.assignedBySupervisionPaused.${language}`, { ...values, paused })
        : t(`staffLine.assignedBySupervision.${language}`, values)
    }
    case 'reassigned': {
      if (!supervisor || !previous || !analyst) return null
      const values = { supervisor, previous, analyst }
      return paused
        ? t('staffLine.reassignedPaused', { ...values, paused })
        : t('staffLine.reassigned', values)
    }
    case 'wrote_again': {
      const customer = text('customer')
      const closedAt = text('closedAt')
      const reason = CLOSE_REASONS_KNOWN.find((value) => value === text('closeReason'))
      if (!customer || !closedAt || !reason || Number.isNaN(Date.parse(closedAt))) return null
      const values = {
        customer,
        date: formatDateTime(closedAt),
        reason: closeReasonLabel(reason).toLocaleLowerCase(i18n.language),
      }
      return text('channel') === 'phone_inbound'
        ? t('staffLine.calledAgain', values)
        : t('staffLine.wroteAgain', values)
    }
    case 'escalated':
      return analyst ? t('staffLine.escalated', { analyst }) : null
    case 'escalation_withdrawn':
      return analyst ? t('staffLine.escalationWithdrawn', { analyst }) : null
    case 'escalation_answered':
      return supervisor ? t('staffLine.escalationAnswered', { supervisor }) : null
    case 'escalation_taken':
      return supervisor && previous
        ? t('staffLine.escalationTaken', { supervisor, previous })
        : null
    case 'assistant_released': {
      // An unknown reason reads as a failure, as the server's Spanish text does. The handoff's
      // reference (an agent-core UUID) is not shown: the handoff card carries what it holds.
      const reason = text('reason')
      return t(`staffLine.assistantReleased.${isReleaseReason(reason) ? reason : 'failed'}`, {
        code: text('code') ?? t('staffLine.noDetail'),
        who: text('who') ?? t('staffLine.supervision'),
      })
    }
    case 'follow_up_call': {
      const customer = text('customer')
      return analyst && customer ? t('staffLine.followUpCall', { analyst, customer }) : null
    }
    default:
      return null
  }
}

/** What a turn says on screen: a staff-only line from its facts, else the stored text. */
export function turnText(turn: Turn): string {
  return (turn.staffLine ? staffLineText(turn.staffLine) : null) ?? turn.text
}

/** Confirmed turns in sequence order, then the pending messages in the order they were sent. */
export function toTranscriptItems(
  cache: TranscriptCache,
  meId: string,
  context: TranscriptContext = {},
): TranscriptItem[] {
  const unanswered = unansweredEmailIds(cache.turns)
  const lastEmailId = cache.turns.findLast((turn) => turn.kind === 'email')?.id ?? null
  const confirmed = cache.turns.map((turn): TranscriptItem => {
    const variant = turnVariant(turn, meId)
    return {
      key: turn.clientMessageId ?? turn.id,
      variant,
      text: turnText(turn),
      author: turnAuthor(turn, variant, meId),
      createdAt: turn.createdAt,
      sequence: turn.sequence,
      staffOnly: turn.audience === 'staff',
      delivery: 'sent',
      error: null,
      retryable: false,
      clientMessageId: turn.clientMessageId,
      ...channelFields(turn, variant, meId, context, unanswered, lastEmailId),
    }
  })
  const pending = cache.pending.map((message): TranscriptItem => ({
    key: message.clientMessageId,
    variant: 'own',
    text: message.text,
    author: t('transcript.you'),
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
  return item.staffOnly ? t('transcript.internalNote') : t('transcript.customerNotice')
}

// ── Header ──────────────────────────────────────────────────────────────────

/**
 * The facts after the case number in the supervisor view's header (contract §9.3; no
 * dot-joined line): the place, the channel (icon-only) and, for a Portuguese case,
 * its language mark "[PT]" (rule 3: the only cue outside the transcript that the reply
 * must be in Portuguese). Slice 8: the priority is a control of its own (the menu in the header).
 */
export function caseHeaderFacts(detail: Pick<CaseDetail, 'case' | 'customer'>): FactItem[] {
  const { case: summary, customer } = detail
  const facts: FactItem[] = [
    {
      key: 'place',
      icon: 'map-pin',
      text: `${customer.city}, ${countryName(customer.country)}`,
      label: t('header.city'),
    },
    channelFact(summary.channel),
  ]
  if (summary.language === 'pt') {
    facts.push({
      key: 'language',
      icon: 'languages',
      text: '',
      label: t('header.language'),
      languages: ['pt'],
    })
  }
  return facts
}

/**
 * Short case number for the header ("CASE-…0103", "CASE-…F2BC"): the full
 * 31-character id would push the meta line (place, channel, language mark)
 * out of view. The full id stays in the tooltip, the accessible name and "Copiar".
 */
export function shortCaseId(id: string): string {
  const dash = id.indexOf('-')
  if (id.length <= 14 || dash < 0) return id
  return `${id.slice(0, dash + 1)}…${id.slice(-4)}`
}

/** "Casos anteriores (2)": the header button, shown only when there are any. */
export function previousCasesLabel(count: number): string | null {
  return count > 0 ? t('header.previousCases', { total: count }) : null
}

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? ''
}

// ── Arrival note (people-based assignment only, contract §9.3, slice 3 §8.3) ─

/**
 * "español" / "portugués", as the copy says the case language (in the UI language: getters
 * over the catalog, read when shown).
 */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  get es() {
    return t('languageName.es')
  },
  get pt() {
    return t('languageName.pt')
  },
}

/**
 * Names of the language queues (team-generated, slice 2 §3.3; the backend sends
 * the same text, in Spanish, as `LanguageQueue.label` / `AssignmentOut.queueLabel`), in the
 * UI language (getters over the catalog). Needed here for a queued case, which has no
 * assignment to carry the label yet.
 */
export const QUEUE_LABEL: Readonly<Record<Language, string>> = {
  get es() {
    return t('queueLabel.es')
  },
  get pt() {
    return t('queueLabel.pt')
  },
}

/**
 * The backend's queue labels (`AssignmentOut.queueLabel`, its fixed Spanish text) → the
 * queue's language, so the screens name the queue in the UI language. Data, not copy.
 */
const SERVER_QUEUE_LANGUAGE: Readonly<Partial<Record<string, Language>>> = {
  'Cola en español': 'es',
  'Cola en portugués': 'pt',
}

/**
 * The queue an assignment came from: its language when the label is a known queue (or there
 * is no label: the case's queue), else the server's label as it came.
 */
function assignmentQueue(
  queueLabel: string | null | undefined,
  caseLanguage: Language,
): { language: Language } | { label: string } {
  if (!queueLabel) return { language: caseLanguage }
  const language = SERVER_QUEUE_LANGUAGE[queueLabel]
  return language ? { language } : { label: queueLabel }
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

/**
 * The arrival note of the supervisor's read-only case view (slice 3 §8.3; slice 9: no
 * " · " joins, the time is its own clock fact):
 * - queued: "Sin asignar desde las 10:47: nadie disponible habla español" (no time fact);
 * - `language_least_loaded`: "Lo atiende Daniela Ríos: le llegó al estar disponible y hablar
 *   portugués (regla 3)";
 * - `queue_drained`: "Lo atiende Daniela Ríos: le llegó desde la cola en portugués tras 6 min";
 * - `manual`: "Lo atiende Julián Ortega: se lo pasó Lucía Herrera" ("se lo asignó" from the
 *   queue);
 * - closed: "Lo atendió Julián Ortega".
 * `time` is when it was assigned ("5 mar, 10:58"), shown next to the line with a clock.
 */
export function supervisionArrivalLine(
  detail: Pick<CaseDetail, 'assignment' | 'case'>,
): { line: string; time: string | null } | null {
  const { assignment, case: summary } = detail
  const language = LANGUAGE_NAMES[summary.language]
  if (summary.status === 'with_assistant') {
    return {
      line: t('arrival.line.withAssistant', { time: formatTime(summary.openedAt) }),
      time: null,
    }
  }
  if (summary.status === 'queued') {
    return {
      line: t('arrival.line.queued', { time: formatTime(summary.openedAt), language }),
      time: null,
    }
  }
  if (!assignment) return null
  const name = assignment.analystName
  if (summary.status === 'closed') return { line: t('arrival.line.closed', { name }), time: null }
  const time = formatDateTime(assignment.assignedAt, { withYear: false })
  switch (assignment.reason) {
    case 'queue_drained': {
      const from = assignmentQueue(assignment.queueLabel, summary.language)
      const queue = 'language' in from ? t(`arrival.line.queue.${from.language}`) : from.label
      return {
        line:
          assignment.waitedSeconds !== null
            ? t('arrival.line.fromQueueAfter', {
                name,
                queue,
                wait: formatWait(assignment.waitedSeconds),
              })
            : t('arrival.line.fromQueue', { name, queue }),
        time,
      }
    }
    case 'manual': {
      const by = assignment.assignedByName ?? t('arrival.line.bySupervision')
      return {
        line:
          assignment.previousAnalystId === null
            ? t('arrival.line.assignedBy', { name, by })
            : t('arrival.line.passedBy', { name, by }),
        time,
      }
    }
    case 'assistant_handoff':
      return { line: t('arrival.line.afterHandoff', { name }), time }
    default:
      return {
        line:
          summary.language === 'pt'
            ? t('arrival.line.availableRule3', { name, language })
            : t('arrival.line.available', { name, language }),
        time,
      }
  }
}

// ── Read-only footer and closure (contract §9.3) ────────────────────────────

/** "Nota: …" under the closure facts, or null without a note. */
export function closureNote(closure: Pick<CaseClosure, 'note'>): string | null {
  const note = closure.note?.trim()
  return note ? t('footer.note', { note }) : null
}

/**
 * Footer of the supervisor's read-only case view (slice 3 §8.3) for an open case, which never
 * has a composer. Slice 9 (assignment is automatic; supervision no longer assigns a queued
 * case): queued "Sin asignar: le llega automáticamente a la primera persona disponible que
 * hable español."; open "Solo lectura: lo atiende {analista}.". A closed case has no lines:
 * its footer is the closure as facts (`closedFooter`), the same as in the Workspace.
 */
export function supervisionFooter(
  detail: Pick<CaseDetail, 'case' | 'closure' | 'assignment'>,
): string[] | null {
  const { case: summary, closure, assignment } = detail
  if (closure) return null
  if (summary.status === 'with_assistant') {
    return [t('footer.supervision.withAssistant', { language: LANGUAGE_NAMES[summary.language] })]
  }
  if (summary.status === 'queued' || !assignment) {
    return [t('footer.supervision.queued', { language: LANGUAGE_NAMES[summary.language] })]
  }
  return [t('footer.supervision.readOnly', { name: assignment.analystName })]
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
        return { message: t('sendFailure.closed'), retryable: false }
      case 'case_not_assigned':
      case 'forbidden':
        return { message: t('sendFailure.notAssigned'), retryable: false }
      case 'idempotency_conflict':
        return { message: t('sendFailure.conflict'), retryable: false }
      case 'validation_error':
        return { message: t('sendFailure.invalid'), retryable: false }
      default:
        break
    }
  }
  return { message: t('transcript.notSent'), retryable: true }
}

export function describeCaseLoadFailure(error: unknown): { title: string; description: string } {
  if (isApiProblem(error, 'case_not_assigned') || isApiProblem(error, 'forbidden')) {
    return { title: t('loadFailure.forbiddenTitle'), description: t('loadFailure.forbiddenText') }
  }
  if (isApiProblem(error, 'not_found')) {
    return { title: t('loadFailure.notFoundTitle'), description: t('loadFailure.notFoundText') }
  }
  return { title: t('loadFailure.genericTitle'), description: t('loadFailure.genericText') }
}

// ── "Ficha del cliente" (slice 6 §5: the right panel of the Workspace) ──────
//
// UI rule (slice 6 §4.7): one fact per row (icon + label, a short value), the
// status as a pill, times with a clock; never a dot-joined line or a sentence.

/** Id of the Workspace panel (`aria-controls` of the name button). */
export const CUSTOMER_FILE_PANEL_ID = 'ficha-del-cliente'
/** Id of the name button (the focus returns to it when the panel closes). */
export const CUSTOMER_FILE_TRIGGER_ID = 'ficha-del-cliente-boton'
/** Slice 20: the header's "Apoyo" button (AI on), the other trigger of the same panel. */
export const SUPPORT_PANEL_TRIGGER_ID = 'apoyo-del-caso-boton'

/** The customer-name button of the slim header: "Ver ficha de Beatriz Salcedo Prieto". */
export function customerFileTriggerLabel(customerName: string): string {
  return t('header.openFile', { name: customerName })
}

/** One row of the file: an icon and a label, then the value (text, a pill or facts). */
export interface FileRow {
  key: string
  icon: FactIcon
  label: string
  text?: string
  mono?: boolean
  /** The case status as glyph + word (`caseStatus`, the cases map). */
  status?: StatusAppearance
  /** A language as a globe and its own name ("[globe] Português"), no code. */
  language?: Language
  /** The customer's rating, with its face, as a colored pill. */
  pill?: { label: string; tone: Tone; icon?: FactIcon }
  /** The case priority (slice 8): the menu when the viewer may change it, else glyph + word. */
  priority?: CasePriority
  /** The case type (slice 18, AI on only): the menu when the viewer may change it, else the word. */
  caseType?: CaseType
  /** Short facts as the value ("Primera respuesta"). */
  facts?: FactItem[]
}

/** "Cliente": name, city and country, language, customer id (only what the platform has). */
export function customerRows(detail: Pick<CaseDetail, 'customer'>): FileRow[] {
  const { customer } = detail
  return [
    { key: 'name', icon: 'user', label: t('file.name'), text: customer.displayName },
    {
      key: 'place',
      icon: 'map-pin',
      label: t('file.city'),
      text: `${customer.city}, ${countryName(customer.country)}`,
    },
    { key: 'language', icon: 'languages', label: t('file.language'), language: customer.language },
    { key: 'id', icon: 'id', label: t('file.customerId'), text: customer.id, mono: true },
  ]
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
        ? { key: 'result', icon: 'check', text: t('file.onTime'), tone: 'success' }
        : { key: 'result', icon: 'alert', text: t('file.late'), tone: 'danger' },
      {
        key: 'at',
        icon: 'clock',
        text: formatDateTime(summary.firstResponseAt, { withYear: false }),
        label: t('file.answered'),
        tooltip: t('file.answered'),
        tone: 'muted',
      },
    ]
  }
  const sla = slaFact(summary, now)
  return sla ? [sla] : [{ key: 'result', icon: 'alert', text: t('file.noAnswer'), tone: 'muted' }]
}

/**
 * "Este caso": number, channel, priority, (slice 18, only with the AI switch on) the case
 * type, opened, status and the first response.
 */
export function caseRows(
  detail: Pick<CaseDetail, 'case'>,
  now: Date | string | number,
  { aiEnabled = false }: { aiEnabled?: boolean } = {},
): FileRow[] {
  const { case: summary } = detail
  return [
    { key: 'id', icon: 'hash', label: t('file.number'), text: summary.id, mono: true },
    {
      key: 'channel',
      icon: caseChannel(summary.channel).icon,
      label: t('file.channel'),
      text: channelLabel(summary.channel),
    },
    {
      key: 'priority',
      icon: 'flag',
      label: t('file.priority'),
      text: casePriority(summary.priority).label,
      priority: summary.priority,
    },
    ...(aiEnabled ? [caseTypeRow(summary.caseType)] : []),
    {
      key: 'opened',
      icon: 'calendar-clock',
      label: t('file.opened'),
      text: formatDateTime(summary.openedAt, { withYear: false }),
    },
    {
      key: 'status',
      icon: 'inbox',
      label: t('file.status'),
      status: caseStatus(summary.inboxStatus),
    },
    {
      key: 'first-response',
      icon: 'clock',
      label: t('file.firstResponse'),
      facts: firstResponseFacts(summary, now),
    },
    ...(summary.status === 'closed' ? [ratingRow(summary.rating)] : []),
  ]
}

/** "Tipo de caso" (slice 18): the menu or the word, drawn by the ficha. */
export function caseTypeRow(value: CaseType): FileRow {
  return {
    key: 'case-type',
    icon: 'tag',
    label: t('file.caseType'),
    text: caseType(value).label,
    caseType: value,
  }
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
      label: t('file.rating'),
      pill: { label: t('file.unrated'), tone: 'closed' },
    }
  }
  const option = ratingOption(rating.score)
  return {
    key: 'rating',
    icon: 'smile',
    label: t('file.rating'),
    pill: { label: option.label, tone: option.tone, icon: option.icon },
  }
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
 * - hers, on arrival: [check] Estabas disponible, [languages] Hablas [PT] + "Regla 3";
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
          text: t('arrival.assignedBy', {
            name: assignment.assignedByName ?? t('arrival.supervision'),
          }),
        }
      : null
  const waited: FactItem | null =
    assignment.waitedSeconds !== null
      ? {
          key: 'waited',
          icon: 'hourglass',
          text: t('arrival.waited', { wait: formatWait(assignment.waitedSeconds) }),
        }
      : null
  const keep = (facts: (FactItem | null)[]) =>
    facts.filter((fact): fact is FactItem => fact !== null)

  if (assignment.analystId !== meId) {
    const closed = summary.status === 'closed'
    return {
      heading: closed ? t('arrival.whoAttended') : t('arrival.whoAttends'),
      time,
      facts: keep([
        { key: 'analyst', icon: 'user', text: assignment.analystName },
        closed ? null : by,
      ]),
    }
  }
  const heading = t('arrival.heading')
  if (assignment.reason === 'assistant_handoff') {
    // Slice 19: the assistant escalated it; she got it like any arrival (rule 3).
    return {
      heading,
      time,
      facts: [
        { key: 'assistant', icon: 'bot', text: t('arrival.afterHandoff'), tone: 'accent' },
        {
          key: 'language',
          icon: 'languages',
          text: t('arrival.youSpeak'),
          languages: [summary.language],
          ...(summary.language === 'pt' ? { tag: t('arrival.rule3') } : {}),
        },
      ],
    }
  }
  if (assignment.reason === 'manual') {
    const previous = assignment.previousAnalystId
      ? {
          key: 'previous',
          icon: 'user' as const,
          text: t('arrival.previous', {
            name: assignment.previousAnalystName ?? t('arrival.someoneElse'),
          }),
        }
      : null
    return { heading, time, facts: keep([by, previous ?? waited]) }
  }
  if (assignment.reason === 'queue_drained') {
    const from = assignmentQueue(assignment.queueLabel, summary.language)
    const queue = 'language' in from ? QUEUE_LABEL[from.language] : from.label
    return {
      heading,
      time,
      facts: keep([
        waited,
        { key: 'queue', icon: 'inbox', text: queue },
        { key: 'available', icon: 'check', text: t('arrival.becameAvailable'), tone: 'success' },
      ]),
    }
  }
  return {
    heading,
    time,
    facts: [
      { key: 'available', icon: 'check', text: t('arrival.wereAvailable'), tone: 'success' },
      {
        key: 'language',
        icon: 'languages',
        text: t('arrival.youSpeak'),
        languages: [summary.language],
        ...(summary.language === 'pt' ? { tag: t('arrival.rule3') } : {}),
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
  if (closure) return closedFooter({ closure, case: detail.case }, meId)
  const facts: FactItem[] = [{ key: 'read-only', icon: 'lock', text: t('footer.readOnly') }]
  if (assignment && assignment.analystId !== meId) {
    facts.push({
      key: 'owner',
      icon: 'user',
      text: t('footer.owner', { name: assignment.analystName }),
    })
  }
  return { reason: null, facts, note: null, rating: null }
}

/**
 * A closed case's footer as facts, in the Workspace and in the supervisor view (never a
 * " · " joined line): the reason (icon + label, drawn by the component), [clock] when,
 * [user] who closed it when it was someone else, the note, the customer's rating.
 */
export function closedFooter(
  detail: {
    closure: Pick<CaseClosure, 'closedAt' | 'closedById' | 'closedByName' | 'reason' | 'note'>
    case?: Pick<CaseDetail['case'], 'rating'>
  },
  meId: string,
): FooterFacts {
  const { closure } = detail
  const facts: FactItem[] = [
    {
      key: 'closed-at',
      icon: 'clock',
      text: formatDateTime(closure.closedAt, { withYear: false }),
      label: t('footer.closedAt'),
      tooltip: t('footer.closedAt'),
    },
  ]
  if (closure.closedById !== meId && closure.closedByName) {
    facts.push({
      key: 'closed-by',
      icon: 'user',
      text: closure.closedByName,
      label: t('footer.closedBy'),
      tooltip: t('footer.closedBy'),
    })
  }
  return {
    reason: closure.reason,
    facts,
    note: closureNote(closure),
    rating: detail.case?.rating ?? null,
  }
}

/**
 * A row of "Casos anteriores" as facts: [calendar] date, [user] who, and (slice 7) the
 * customer's rating as the colored face alone (slice 8: tooltip and accessible text
 * "Calificación: Excelente"). The reason of a closed case, or the status of an open one
 * (`caseLifecycleStatus`), is drawn before them.
 */
export function historyItemFacts(
  item: Pick<CaseHistoryItem, 'openedAt' | 'analystName'> &
    Partial<Pick<CaseHistoryItem, 'rating'>>,
): FactItem[] {
  const rating = ratingFact(item.rating)
  return [
    { key: 'date', icon: 'calendar', text: formatDate(item.openedAt), label: t('history.opened') },
    { key: 'analyst', icon: 'user', text: item.analystName ?? t('history.unassigned') },
    ...(rating ? [rating] : []),
  ]
}

/** The quoted comment under the rating pill: “Muy clara…” (none → null). */
export function ratingComment(rating: Pick<CaseRating, 'comment'> | null): string | null {
  return rating?.comment ? `“${rating.comment}”` : null
}

/** "Casos anteriores (2)", the panel section title (also without any: "(0)"). */
export function previousCasesSectionTitle(count: number): string {
  return t('header.previousCases', { total: count })
}

// ── "Casos anteriores de este cliente" (contract §4.7, §9.4) ────────────────

/** "Casos anteriores de Patricia". */
export function historySheetTitle(customerName: string): string {
  const first = firstName(customerName)
  return first ? t('history.title', { name: first }) : t('history.titlePlain')
}

/** Shown under the list when the server capped it (it returns at most 20). */
export function historyTruncatedNote(shown: number, total: number): string | null {
  return total > shown ? t('history.truncated') : null
}

// ── Priority (slice 8) ───────────────────────────────────────────────────────

/** The toast after a priority change failed (the menu shows the previous level again). */
export function describePriorityFailure(error: unknown): { title: string; description: string } {
  const title = t('priorityFailure.title')
  if (!isApiProblem(error)) return { title, description: t('failure.retry') }
  switch (error.code) {
    case 'version_conflict': {
      const current = error.extensions.current
      const priority =
        typeof current === 'object' && current !== null && 'priority' in current
          ? (current.priority as CasePriority)
          : null
      return {
        title,
        description: priority
          ? t('priorityFailure.conflictNow', { priority: casePriority(priority).label })
          : t('priorityFailure.conflict'),
      }
    }
    case 'case_closed':
      return { title, description: t('failure.caseClosed') }
    case 'case_not_assigned':
    case 'forbidden':
      return { title, description: t('priorityFailure.forbidden') }
    case 'network_error':
      return { title, description: t('failure.network') }
    default:
      return { title, description: t('failure.retry') }
  }
}

// ── Case type (slice 18) ────────────────────────────────────────────────────

/** The toast after a case-type change failed (the menu shows the previous type again). */
export function describeCaseTypeFailure(error: unknown): { title: string; description: string } {
  const title = t('caseTypeFailure.title')
  if (!isApiProblem(error)) return { title, description: t('failure.retry') }
  switch (error.code) {
    case 'version_conflict': {
      const current = conflictCurrentCase(error)
      return {
        title,
        description: current
          ? t('caseTypeFailure.conflictNow', { caseType: caseType(current.caseType).label })
          : t('caseTypeFailure.conflict'),
      }
    }
    case 'case_closed':
      return { title, description: t('failure.caseClosed') }
    case 'case_not_assigned':
    case 'forbidden':
      return { title, description: t('caseTypeFailure.forbidden') }
    case 'network_error':
      return { title, description: t('failure.network') }
    default:
      return { title, description: t('failure.retry') }
  }
}

/** The case of a `version_conflict` (`current`), when it is a case summary. */
export function conflictCurrentCase(error: unknown): CaseSummary | null {
  if (!isApiProblem(error) || error.code !== 'version_conflict') return null
  const current = error.extensions.current
  if (typeof current !== 'object' || current === null) return null
  const record = current as Record<string, unknown>
  return typeof record.id === 'string' &&
    typeof record.version === 'number' &&
    typeof record.priority === 'string'
    ? (current as CaseSummary)
    : null
}

// ── Close dialog (contract §4.4, §9.5) ──────────────────────────────────────

/** Maximum length of the internal note, after trimming. */
export const CLOSE_NOTE_MAX_LENGTH = 500

/**
 * The notice the customer gets when the case closes, in the case language (not the UI
 * language: it is what the customer reads). It must stay identical to the backend text
 * (contract §3.3); a model test pins it.
 */
export const CLOSED_NOTICE: Record<Language, string> = {
  // i18n-ignore-next-line: the customer's text in the case language, mirrored from the backend
  es: 'La conversación terminó. Si necesitas algo más, escríbenos y te atendemos en una nueva conversación.',
  // i18n-ignore-next-line: the customer's text in the case language, mirrored from the backend
  pt: 'A conversa foi encerrada. Se precisar de algo mais, escreva para nós e abrimos uma nova conversa.',
}

export interface CloseCaseForm {
  /** null until the analyst picks a reason (required). */
  reason: CloseReason | null
  /** Internal note, optional ('' = none). Only staff see it. */
  note: string
  /**
   * Slice 19: "¿Te sirvió el traspaso del asistente?" (optional, only asked when the handoff
   * loaded). null = not answered: nothing is sent, the platform never guesses a label.
   */
  handoffQuality: HandoffQuality | null
  /**
   * Event catalog 1.3.0: with `incomplete` only, what she had to ask the customer again
   * (optional, a closed list). Sent as `handoffReasked` only when something is ticked.
   */
  handoffReasked: HandoffReask[]
}

export const INITIAL_CLOSE_FORM: CloseCaseForm = {
  reason: null,
  note: '',
  handoffQuality: null,
  handoffReasked: [],
}

export type CloseFormErrors = Partial<Record<keyof CloseCaseForm, string>>

export function validateCloseForm(form: CloseCaseForm): CloseFormErrors {
  const errors: CloseFormErrors = {}
  if (form.reason === null) errors.reason = t('close.reasonRequired')
  if (form.note.trim().length > CLOSE_NOTE_MAX_LENGTH) {
    errors.note = t('close.noteTooLong')
  }
  return errors
}

/**
 * `{ reason, note: trimmed || null }`, plus `handoffQuality` only when she answered it (slice
 * 19) and `handoffReasked` only for `incomplete` with something ticked (catalog 1.3.0). Call it
 * only after `validateCloseForm` passed.
 */
export function toCloseRequest(form: CloseCaseForm & { reason: CloseReason }): CloseCaseRequest {
  const request: CloseCaseRequest = { reason: form.reason, note: form.note.trim() || null }
  if (!form.handoffQuality) return request
  const reasked = form.handoffQuality === 'incomplete' ? form.handoffReasked : []
  return reasked.length > 0
    ? { ...request, handoffQuality: form.handoffQuality, handoffReasked: reasked }
    : { ...request, handoffQuality: form.handoffQuality }
}

/** "{n}/500" under the note (trimmed length, as the server counts it). */
export function noteCounter(note: string): string {
  return `${note.trim().length}/${CLOSE_NOTE_MAX_LENGTH}`
}

export function describeCloseFailure(error: unknown): string {
  if (isApiProblem(error, 'case_closed')) return t('close.failure.alreadyClosed')
  if (isApiProblem(error, 'call_in_progress')) return t('close.failure.callInProgress')
  if (isApiProblem(error, 'invalid_transition')) return t('close.failure.invalidTransition')
  if (isApiProblem(error, 'case_not_assigned')) return t('close.failure.notAssigned')
  if (isApiProblem(error, 'validation_error')) return t('close.failure.validation')
  return t('close.failure.generic')
}

// ── Escalation to supervision (slice 9) ──────────────────────────────────────

/** "Motivo" counter of the escalate dialog: "37/500" (trimmed, like the server). */
export function motiveCounter(motive: string): string {
  return `${motive.trim().length}/${MAX_ESCALATION_TEXT}`
}

/** Client check of the motive before the request: required, at most 500 characters. */
export function validateMotive(motive: string): string | null {
  const length = motive.trim().length
  if (length === 0) return t('escalation.motiveRequired')
  if (length > MAX_ESCALATION_TEXT) {
    return t('escalation.motiveTooLong', { max: MAX_ESCALATION_TEXT })
  }
  return null
}

/** Whether "Escalar a supervisión" shows: the assignee of an open case not escalated yet. */
export function canEscalate(detail: Pick<CaseDetail, 'case' | 'capabilities'>): boolean {
  return (
    detail.capabilities.canEscalate &&
    !detail.case.escalated &&
    detail.case.status !== 'closed' &&
    detail.case.status !== 'queued'
  )
}

export type EscalationAction = 'escalate' | 'withdraw' | 'acknowledge'

/** One line per failure of the escalation commands (branch on the code, never the text). */
export function describeEscalationFailure(error: unknown, action: EscalationAction): string {
  const fallback = t(`escalation.failure.${action}`)
  if (!isApiProblem(error)) return fallback
  switch (error.code) {
    case 'escalation_open':
      return t('escalation.failure.alreadyOpen')
    case 'escalation_not_open':
      return error.stringExtension('currentState') === 'withdrawn'
        ? t('escalation.failure.withdrawn')
        : t('escalation.failure.attended')
    case 'case_closed':
      return t('escalation.failure.caseClosed')
    case 'case_not_assigned':
      return action === 'escalate'
        ? t('escalation.failure.notAssignedEscalate')
        : t('escalation.failure.notAssigned')
    case 'validation_error':
    case 'invalid_value':
      return t('escalation.failure.invalid')
    case 'network_error':
      return t('failure.network')
    default:
      return fallback
  }
}

/** What the staff-only card under the header shows (or nothing). */
export type EscalationCard =
  | {
      kind: 'open'
      escalation: Escalation
      title: string
      /** Who escalated, shown in supervision ("Daniela Ríos"); null for her own card. */
      byName: string | null
      since: string
      sinceTooltip: string
      /** "Retirar escalamiento": the assignee in the Workspace. */
      canWithdraw: boolean
    }
  | {
      kind: 'attended'
      escalation: Escalation
      title: string
      resolverName: string
      /** Supervision's answer (answered only). */
      note: string | null
      since: string
      sinceTooltip: string
    }

type DateInput = Date | string | number

function attendedTitle(
  escalation: Escalation,
  name: string,
  since: string,
): { title: string; sinceTooltip: string } {
  switch (escalation.state) {
    case 'taken':
      return {
        title: t('escalation.card.taken', { name }),
        sinceTooltip: t('escalation.card.takenSince', { since }),
      }
    case 'reassigned':
      return {
        title: t('escalation.card.reassigned', {
          name,
          to: escalation.reassignedToName ?? t('escalation.card.reassignedFallback'),
        }),
        sinceTooltip: t('escalation.card.reassignedSince', { since }),
      }
    default:
      return {
        title: t('escalation.card.answered', { name }),
        sinceTooltip: t('escalation.card.answeredSince', { since }),
      }
  }
}

/**
 * The escalation card of a case (Workspace.dc.html "escalado" / "respondido"):
 * - Workspace, the assignee, an open escalation → her card with "Retirar escalamiento";
 * - Workspace, who escalated, supervision answered / took / reassigned it and she has not
 *   said "Entendido" → what supervision did (also when the case left her: she still reads it);
 * - supervision view → the open escalation, read-only;
 * - anything else (none, withdrawn, ended with the case, a closed case) → null.
 */
export function escalationCardOf(
  detail: Pick<CaseDetail, 'case' | 'escalation'>,
  meId: string,
  mode: ConversationMode,
  now: DateInput,
): EscalationCard | null {
  const escalation = detail.escalation
  if (!escalation || detail.case.status === 'closed') return null
  if (escalation.state === 'open') {
    if (mode === 'supervision') {
      const by = escalation.escalatedByName ?? t('escalation.card.someone')
      const since = formatRelativeTime(escalation.escalatedAt, now)
      return {
        kind: 'open',
        escalation,
        title: t('escalation.card.title'),
        byName: by,
        since,
        sinceTooltip: t('escalation.card.escalatedSince', { since }),
        canWithdraw: false,
      }
    }
    if (detail.case.assignedAnalystId !== meId) return null
    const since = formatRelativeTime(escalation.escalatedAt, now)
    return {
      kind: 'open',
      escalation,
      title: t('escalation.card.title'),
      byName: null,
      since,
      sinceTooltip: t('escalation.card.youEscalatedSince', { since }),
      canWithdraw: true,
    }
  }
  if (
    mode !== 'workspace' ||
    !isAttendedEscalation(escalation.state) ||
    escalation.acknowledgedAt !== null ||
    escalation.escalatedById !== meId
  ) {
    return null
  }
  const name = escalation.resolvedByName ?? t('escalation.card.supervision')
  const since = formatRelativeTime(escalation.resolvedAt ?? escalation.escalatedAt, now)
  const { title, sinceTooltip } = attendedTitle(escalation, name, since)
  return {
    kind: 'attended',
    escalation,
    title,
    resolverName: name,
    note: escalation.state === 'answered' ? escalation.note : null,
    since,
    sinceTooltip,
  }
}
