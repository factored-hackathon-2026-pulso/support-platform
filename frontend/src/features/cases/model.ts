/**
 * Pure rules and copy of the case list (Workspace.dc.html; contract
 * docs/platform/api/slice-2-case-lifecycle.md §4.1–§4.5, §9.1). No React, no
 * I/O: unit-tested in model.test.ts.
 */
import type { FactIcon, FactItem, FactTone, StatusAppearance, Tone } from '@/components/ui'
import { formatRelativeTime } from '@/lib/format'
import type {
  CaseChannel,
  CasePriority,
  CaseRating,
  CaseStatus,
  CaseSummary,
  CloseReason,
  CountryCode,
  EscalationState,
  InboxCounts,
  InboxResponse,
  InboxStatus,
} from './types'

// ─── Case status: the one map (Linear-style glyph + word) ────────────────────

/** An inbox status, or `queued`: in no analyst inbox yet (supervision's queue). */
export type CaseStatusKey = InboxStatus | 'queued'

export interface CaseStatusConfig extends StatusAppearance {
  /** Tile / filter / bucket name, plural: "Nuevos", "Cerrados". */
  bucket: string
}

/**
 * Every place that shows a case's status reads this map (cards, Inicio, the
 * ficha, the header, supervision): dashed ring = nobody has it, empty ring =
 * new, ¾ pie = it needs you, ½ pie = the customer has the ball, check = closed.
 * `tone` also drives the status stripes (`toneBorderLeft`).
 */
export const CASE_STATUS: Readonly<Record<CaseStatusKey, CaseStatusConfig>> = {
  queued: { shape: 'dashed', tone: 'neutral', label: 'Sin asignar', bucket: 'Sin asignar' },
  new: { shape: 'ring', tone: 'accent', label: 'Nuevo', bucket: 'Nuevos' },
  to_reply: {
    shape: 'pie-75',
    tone: 'warn',
    label: 'Por responder',
    bucket: 'Por responder',
    strong: true,
  },
  waiting: {
    shape: 'pie-50',
    tone: 'waiting',
    label: 'Esperando al cliente',
    bucket: 'Esperando al cliente',
  },
  closed: { shape: 'check', tone: 'closed', label: 'Cerrado', bucket: 'Cerrados' },
}

/** A past case still open, outside any inbox view ("Casos anteriores"). */
export const OPEN_CASE_STATUS: StatusAppearance = {
  shape: 'pie-25',
  tone: 'accent',
  label: 'Abierto',
}

function appearance({ shape, tone, label, strong }: CaseStatusConfig): StatusAppearance {
  return strong ? { shape, tone, label, strong } : { shape, tone, label }
}

/** The status of a case as glyph + word (`null` inbox status = queued, "Sin asignar"). */
export function caseStatus(inboxStatus: InboxStatus | null): StatusAppearance {
  return appearance(CASE_STATUS[inboxStatus ?? 'queued'])
}

/** A case by its lifecycle status (past cases have no inbox status): queued, open or closed. */
export function caseLifecycleStatus(status: CaseStatus): StatusAppearance {
  if (status === 'queued') return appearance(CASE_STATUS.queued)
  if (status === 'closed') return appearance(CASE_STATUS.closed)
  return OPEN_CASE_STATUS
}

// ─── Filters (the status counters ARE the filters) ──────────────────────────

export interface InboxFilter {
  /** `null` = Todos. */
  status: InboxStatus | null
  label: string
  /** URL slug (`?estado=`); `null` for Todos (no param). */
  slug: string | null
  tone: Tone
}

const filterOf = (status: InboxStatus, slug: string): InboxFilter => ({
  status,
  label: CASE_STATUS[status].bucket,
  slug,
  tone: CASE_STATUS[status].tone,
})

/** Canvas order: Todos · Por responder · Nuevos · Esperando al cliente · Cerrados. */
export const INBOX_FILTERS: readonly InboxFilter[] = [
  { status: null, label: 'Todos', slug: null, tone: 'neutral' },
  filterOf('to_reply', 'por-responder'),
  filterOf('new', 'nuevos'),
  filterOf('waiting', 'esperando'),
  filterOf('closed', 'cerrados'),
]

/**
 * `?estado=` slug → status; unknown or absent → `null` (Todos). Old slugs
 * (`en-curso`, `por-llamar`, `en-espera`) are unknown now, so they fall back to Todos.
 */
export function inboxStatusFromSlug(slug: string | null | undefined): InboxStatus | null {
  if (!slug) return null
  return INBOX_FILTERS.find((filter) => filter.slug === slug)?.status ?? null
}

/** Status → `?estado=` slug; `null` (Todos) → `null` (no param). */
export function slugFromInboxStatus(status: InboxStatus | null): string | null {
  if (!status) return null
  return INBOX_FILTERS.find((filter) => filter.status === status)?.slug ?? null
}

const COUNT_FIELD: Record<InboxStatus, keyof Omit<InboxCounts, 'all' | 'computedAt'>> = {
  new: 'new',
  to_reply: 'toReply',
  waiting: 'waiting',
  closed: 'closed',
}

/** Count shown on a filter tile (`all` = open cases; `closed` = the last 7 days). */
export function countForFilter(counts: InboxCounts, status: InboxStatus | null): number {
  return status ? counts[COUNT_FIELD[status]] : counts.all
}

// ─── Status meta ─────────────────────────────────────────────────────────────

export interface InboxStatusMeta {
  /** Tile / bucket name: "Por responder". */
  label: string
  /** Card `title` and collapsed-rail name: "Nuevo", "Esperando al cliente"… */
  subLabel: string
  tone: Tone
}

/** Bucket, sub-label and tone of a case (contract §4.1, §9.1), from `CASE_STATUS`. */
export function inboxStatusMeta(summary: Pick<CaseSummary, 'inboxStatus'>): InboxStatusMeta {
  const status = CASE_STATUS[summary.inboxStatus ?? 'queued']
  return { label: status.bucket, subLabel: status.label, tone: status.tone }
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export interface CaseChannelConfig {
  value: CaseChannel
  /** The channel family: what the Workspace's central panel shows. */
  kind: 'chat' | 'phone' | 'email'
  /** Chat bubble, phone with an arrow in / out, mail. */
  icon: Extract<FactIcon, 'message' | 'phone-incoming' | 'phone-outgoing' | 'mail'>
  /** "Chat en la app", "Llamada entrante": the tooltip, the accessible text, the ficha row. */
  label: string
}

/**
 * The one channel map of the staff UI (slice 12): how a case opened. Cards, Inicio and the
 * supervision tables show the icon alone (the label is the tooltip); the ficha says the label.
 */
export const CASE_CHANNEL: Readonly<Record<CaseChannel, CaseChannelConfig>> = {
  chat_app: { value: 'chat_app', kind: 'chat', icon: 'message', label: 'Chat en la app' },
  chat_web: { value: 'chat_web', kind: 'chat', icon: 'message', label: 'Chat web' },
  phone_inbound: {
    value: 'phone_inbound',
    kind: 'phone',
    icon: 'phone-incoming',
    label: 'Llamada entrante',
  },
  phone_outbound: {
    value: 'phone_outbound',
    kind: 'phone',
    icon: 'phone-outgoing',
    label: 'Llamada saliente',
  },
  email: { value: 'email', kind: 'email', icon: 'mail', label: 'Correo' },
}

/** The config of a channel (an unknown value reads as a web chat). */
export function caseChannel(channel: CaseChannel): CaseChannelConfig {
  return CASE_CHANNEL[channel] ?? CASE_CHANNEL.chat_web
}

/** "Chat en la app", "Llamada entrante", "Correo". */
export function channelLabel(channel: CaseChannel): string {
  return caseChannel(channel).label
}

// ─── Priority (slice 8: the dataset's complaints.priority levels + "Sin prioridad") ─

export interface CasePriorityConfig {
  value: CasePriority
  /** The level as a value: "Alta", "Sin prioridad" (ficha, menu, supervision). */
  label: string
  /** With the noun, for tooltips and accessible names: "Prioridad alta". */
  longLabel: string
  /** The Linear-style glyph (`PriorityIcon`), also usable as a fact icon. */
  icon: Extract<FactIcon, `priority-${string}`>
  /** Urgency rank: critical 0, high 1, the rest 2 (only critical and high reorder lists). */
  rank: number
}

/**
 * The one priority map of the staff UI (slice 8): every place that shows or changes a
 * priority reads it (the cards, Inicio, the ficha menu, the supervisor view, supervision
 * rows). Menu order as Linear: none first, then the most urgent down.
 */
export const CASE_PRIORITY: Readonly<Record<CasePriority, CasePriorityConfig>> = {
  none: {
    value: 'none',
    label: 'Sin prioridad',
    longLabel: 'Sin prioridad',
    icon: 'priority-none',
    rank: 2,
  },
  critical: {
    value: 'critical',
    label: 'Crítica',
    longLabel: 'Prioridad crítica',
    icon: 'priority-critical',
    rank: 0,
  },
  high: {
    value: 'high',
    label: 'Alta',
    longLabel: 'Prioridad alta',
    icon: 'priority-high',
    rank: 1,
  },
  medium: {
    value: 'medium',
    label: 'Media',
    longLabel: 'Prioridad media',
    icon: 'priority-medium',
    rank: 2,
  },
  low: { value: 'low', label: 'Baja', longLabel: 'Prioridad baja', icon: 'priority-low', rank: 2 },
}

/** The options of the priority menu, in menu order. */
export const PRIORITY_OPTIONS: readonly CasePriorityConfig[] = Object.values(CASE_PRIORITY)

/** The config of a level (an unknown value reads as "Sin prioridad"). */
export function casePriority(priority: CasePriority): CasePriorityConfig {
  return CASE_PRIORITY[priority] ?? CASE_PRIORITY.none
}

/** "Prioridad alta", "Sin prioridad". */
export function priorityLabel(priority: CasePriority): string {
  return casePriority(priority).longLabel
}

/** The trigger of the priority menu: the value, then what it does. */
export function priorityMenuLabel(priority: CasePriority): string {
  return `Prioridad: ${casePriority(priority).label}. Cambiar la prioridad`
}

/** Only critical and high show on a card (slice 8 UI rule): the rest is noise there. */
export function isUrgentPriority(priority: CasePriority): boolean {
  return priority === 'critical' || priority === 'high'
}

const COUNTRY_NAMES: Record<CountryCode, string> = {
  CO: 'Colombia',
  MX: 'México',
  AR: 'Argentina',
  BR: 'Brasil',
}

export function countryName(country: CountryCode): string {
  return COUNTRY_NAMES[country] ?? country
}

/** The channel as an icon-only fact: the icon, the label as tooltip and accessible text. */
export function channelFact(channel: CaseChannel): FactItem {
  const config = caseChannel(channel)
  return { key: 'channel', icon: config.icon, text: config.label, label: 'Canal', iconOnly: true }
}

/**
 * The priority as an icon-only fact (glyph, tooltip and accessible text "Prioridad alta").
 * `onlyUrgent` (cards, Inicio): `null` unless it is high or critical.
 */
export function priorityFact(
  priority: CasePriority,
  { onlyUrgent = true }: { onlyUrgent?: boolean } = {},
): FactItem | null {
  if (onlyUrgent && !isUrgentPriority(priority)) return null
  const config = casePriority(priority)
  return { key: 'priority', icon: config.icon, text: config.longLabel, iconOnly: true }
}

/**
 * The facts of an open card's bottom line (slice 6 UI rule: one fact each, no
 * dot-joined line): channel, priority when high or critical (slice 8), "Volvió a escribir".
 * The status is a pill and the time its own element (CaseCard).
 */
export function caseCardFacts(
  summary: Pick<CaseSummary, 'channel' | 'priority' | 'previousCaseId'> &
    Partial<Pick<CaseSummary, 'activeCallId'>>,
): FactItem[] {
  const facts: (FactItem | null)[] = [
    channelFact(summary.channel),
    // Slice 12: a call on the line right now (the customer may be waiting for "Contestar").
    summary.activeCallId
      ? { key: 'call', icon: 'phone', text: 'Llamada en curso', tone: 'success', iconOnly: true }
      : null,
    priorityFact(summary.priority),
    summary.previousCaseId
      ? {
          key: 'returned',
          icon: 'history',
          text: RETURNED_TAG.label,
          tone: 'accent',
          iconOnly: true,
        }
      : null,
  ]
  return facts.filter((fact): fact is FactItem => fact !== null)
}

// ─── Close reasons (contract §4.4, team-generated list) ─────────────────────

export interface CloseReasonOption {
  value: CloseReason
  label: string
  /** One line under the label in the close dialog (slice 6 §5.4). */
  meaning: string
  /**
   * The reason's color, the same everywhere it shows (dialog card, closed footer,
   * Cerrados cards, "Casos anteriores"); its icon is `CLOSE_REASON_ICON`.
   */
  tone: Tone
}

/** "Motivo" options of the close dialog, in contract order: the one reason → copy/tone map. */
export const CLOSE_REASONS: ReadonlyArray<CloseReasonOption> = [
  { value: 'resolved', label: 'Resuelto', meaning: 'Se atendió lo que pidió.', tone: 'success' },
  {
    value: 'customer_unresponsive',
    label: 'El cliente no respondió',
    meaning: 'Dejó de contestar y no se pudo seguir.',
    tone: 'closed',
  },
  {
    value: 'duplicate',
    label: 'Duplicado',
    meaning: 'Ya hay otro caso por lo mismo.',
    tone: 'accent',
  },
  {
    value: 'out_of_scope',
    label: 'Fuera de alcance',
    meaning: 'Lo que pide no lo atiende este equipo.',
    tone: 'warn',
  },
  { value: 'other', label: 'Otro', meaning: 'Cuéntalo en la nota interna.', tone: 'neutral' },
]

/** The option of a reason (unknown → "Otro"'s look with the raw value as label). */
export function closeReasonOption(reason: CloseReason): CloseReasonOption {
  return (
    CLOSE_REASONS.find((option) => option.value === reason) ?? {
      value: reason,
      label: reason,
      meaning: '',
      tone: 'neutral',
    }
  )
}

/** "Resuelto", "El cliente no respondió"…; `null` → "Sin motivo". */
export function closeReasonLabel(reason: CloseReason | null | undefined): string {
  if (!reason) return 'Sin motivo'
  return CLOSE_REASONS.find((option) => option.value === reason)?.label ?? reason
}

// ─── Customer rating (slice 7: CSAT 1–4, as in the bank's own survey) ─────────

export type RatingScore = 1 | 2 | 3 | 4

export interface RatingOption {
  score: RatingScore
  /** "Mal", "Regular", "Bien", "Excelente". */
  label: string
  /** A face: frown · meh · smile · laugh. */
  icon: FactIcon
  /** Pill tone: 1 danger, 2 warn, 3–4 success. */
  tone: Tone
  /** Text tone of the face alone (same colors). */
  textTone: FactTone
}

/** The one score → words/face/tone map of the staff UI (the audit uses the same words). */
export const RATING_SCALE: ReadonlyArray<RatingOption> = [
  { score: 1, label: 'Mal', icon: 'frown', tone: 'danger', textTone: 'danger' },
  { score: 2, label: 'Regular', icon: 'meh', tone: 'warn', textTone: 'warn' },
  { score: 3, label: 'Bien', icon: 'smile', tone: 'success', textTone: 'success' },
  { score: 4, label: 'Excelente', icon: 'laugh', tone: 'success', textTone: 'success' },
]

/** The option of a score; anything off the scale is clamped to 1–4 (rounded). */
export function ratingOption(score: number): RatingOption {
  const clamped = Math.min(4, Math.max(1, Math.round(Number.isFinite(score) ? score : 1)))
  return RATING_SCALE[clamped - 1] ?? (RATING_SCALE[0] as RatingOption)
}

/** "Bien" (`null` → null). */
export function ratingLabel(rating: Pick<CaseRating, 'score'> | null | undefined): string | null {
  return rating ? ratingOption(rating.score).label : null
}

/**
 * The rating in a list (Cerrados cards, "Casos anteriores"; slice 8: less text) as an
 * icon-only fact: the colored face, the tooltip and accessible text "Calificación: Bien".
 * Unrated → null.
 */
export function ratingFact(rating: Pick<CaseRating, 'score'> | null | undefined): FactItem | null {
  if (!rating) return null
  const option = ratingOption(rating.score)
  return {
    key: 'rating',
    icon: option.icon,
    text: `Calificación: ${option.label}`,
    tone: option.textTone,
    iconOnly: true,
  }
}

// ─── First-response SLA and last interaction (contract §4.5) ──────────────────

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** Remaining time at or under this is shown in orange (team-generated). */
export const SLA_AT_RISK_MS = 5 * MINUTE

export interface SlaDisplay {
  text: string
  atRisk: boolean
}

type DateInput = Date | string | number

const toMs = (value: DateInput) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime()

/**
 * "SLA x" at the top right of a card: the **first-response** SLA, from the
 * server's `slaDueAt` and the real clock ("SLA 9 min", "SLA 5 h", "SLA 2 días",
 * "SLA vencido"). `null` (no tag) once the analyst answered for the first time
 * or the case is closed: the SLA stops there.
 */
export function formatSla(
  summary: Pick<CaseSummary, 'status' | 'slaDueAt' | 'firstResponseAt'>,
  now: DateInput,
): SlaDisplay | null {
  if (summary.firstResponseAt || summary.status === 'closed') return null
  const remaining = toMs(summary.slaDueAt) - toMs(now)
  const atRisk = remaining <= SLA_AT_RISK_MS
  if (remaining <= 0) return { text: 'SLA vencido', atRisk }
  if (remaining < HOUR) return { text: `SLA ${Math.ceil(remaining / MINUTE)} min`, atRisk }
  if (remaining < 2 * DAY) return { text: `SLA ${Math.floor(remaining / HOUR)} h`, atRisk }
  return { text: `SLA ${Math.floor(remaining / DAY)} días`, atRisk }
}

/** How close the first-response SLA is: past due, at risk (≤ 5 min), or running. */
export type SlaLevel = 'overdue' | 'at_risk' | 'normal'

/** "12 min", "5 h", "2 días": the time left, without the word "SLA". */
function remainingText(remainingMs: number): string {
  if (remainingMs < HOUR) return `${Math.ceil(remainingMs / MINUTE)} min`
  if (remainingMs < 2 * DAY) return `${Math.floor(remainingMs / HOUR)} h`
  return `${Math.floor(remainingMs / DAY)} días`
}

/**
 * The one SLA level → icon/tone map (slice 6): overdue = filled flame, danger,
 * "Vencido"; at risk = flame, warn, "1 min"; running = clock, muted, "12 min".
 * The value stays visible; the word "SLA" lives in the accessible text and the
 * tooltip. Used by the Casos cards, Inicio ("Lo primero", "Mientras no estabas")
 * and the customer file. `null` once the first reply was sent or the case closed.
 */
export function slaFact(
  summary: Pick<CaseSummary, 'status' | 'slaDueAt' | 'firstResponseAt'>,
  now: DateInput,
): (FactItem & { level: SlaLevel }) | null {
  if (summary.firstResponseAt || summary.status === 'closed') return null
  const remaining = toMs(summary.slaDueAt) - toMs(now)
  const label = 'SLA de primera respuesta'
  if (remaining <= 0) {
    return {
      key: 'sla',
      level: 'overdue',
      icon: 'flame-filled',
      tone: 'danger',
      text: 'Vencido',
      label,
      tooltip: 'Primera respuesta vencida',
    }
  }
  const left = remainingText(remaining)
  return remaining <= SLA_AT_RISK_MS
    ? {
        key: 'sla',
        level: 'at_risk',
        icon: 'flame',
        tone: 'warn',
        text: left,
        label,
        tooltip: `Vence en ${left}`,
      }
    : {
        key: 'sla',
        level: 'normal',
        icon: 'clock',
        tone: 'muted',
        text: left,
        label,
        tooltip: `Primera respuesta: vence en ${left}`,
      }
}

// ─── Urgency (Inicio "Lo primero" and the Casos list, slice 6 §4.2) ─────────

/**
 * Urgency group of a case at `now` (lower = sooner; slice 8): 0 first-response SLA
 * overdue, 1 critical, 2 high (both: the analyst has to act, not "Esperando al
 * cliente"), 3 SLA at risk (≤ 5 min) or running, 4 the customer waits without an SLA
 * (Nuevo / Por responder after the first reply), 5 Esperando al cliente, 6 closed.
 */
export function urgencyGroup(
  summary: Pick<
    CaseSummary,
    'status' | 'inboxStatus' | 'slaDueAt' | 'firstResponseAt' | 'priority'
  >,
  now: DateInput,
): number {
  if (summary.status === 'closed') return WAITING_GROUP + 1
  if (summary.inboxStatus === 'waiting') return WAITING_GROUP
  if (!summary.firstResponseAt && toMs(summary.slaDueAt) <= toMs(now)) return 0
  const rank = casePriority(summary.priority).rank
  if (rank < 2) return 1 + rank
  return summary.firstResponseAt ? 4 : 3
}

type UrgencyFields = Pick<
  CaseSummary,
  | 'id'
  | 'status'
  | 'inboxStatus'
  | 'slaDueAt'
  | 'firstResponseAt'
  | 'lastInteractionAt'
  | 'priority'
>

/** Esperando al cliente (and closed): the customer has the ball, sort by the longest wait. */
const WAITING_GROUP = 5

/** The SLA still runs: sort by the nearest due time (else by the longest wait). */
function sortsBySla(item: UrgencyFields, group: number): boolean {
  return group < WAITING_GROUP && !item.firstResponseAt
}

/**
 * The one urgency order of open cases (Inicio's "Lo primero" and the Casos list;
 * slice 8): first-response SLA overdue first, then critical, then high, then the
 * nearest `slaDueAt`, then whoever has waited longest without an SLA, Esperando al
 * cliente last. Within a group: the nearest due time while the SLA runs (before any
 * case without one), else the oldest last interaction; ties by id.
 */
export function compareByUrgency(a: UrgencyFields, b: UrgencyFields, now: DateInput): number {
  const group = urgencyGroup(a, now)
  if (group !== urgencyGroup(b, now)) return group - urgencyGroup(b, now)
  const slaA = sortsBySla(a, group)
  const slaB = sortsBySla(b, group)
  if (slaA !== slaB) return slaA ? -1 : 1
  const key = (item: UrgencyFields) => toMs(slaA ? item.slaDueAt : item.lastInteractionAt)
  return key(a) - key(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** A copy of `items` in urgency order at `now` (the input is not changed). */
export function sortByUrgency<T extends UrgencyFields>(items: readonly T[], now: DateInput): T[] {
  return items.slice().sort((a, b) => compareByUrgency(a, b, now))
}

// ─── Availability control (slice 6 §4.3: the control is the pause indicator) ─

export interface AvailabilityControlCopy {
  label: string
  /** Second line while paused. */
  detail: string
  /** Accessible name: the state, then the action a click performs. */
  accessibleName: string
}

export function availabilityControlCopy(status: 'available' | 'paused'): AvailabilityControlCopy {
  return status === 'paused'
    ? {
        label: 'En pausa',
        detail: 'No te llegan casos nuevos',
        accessibleName: 'En pausa. Volver a disponible',
      }
    : {
        label: 'Disponible',
        detail: 'Te llegan casos nuevos',
        accessibleName: 'Disponible. Pausar casos nuevos',
      }
}

// ─── Filter chip (the Casos list filter now lives on Inicio, slice 6 §4.3) ───

/** Chip label of the filter in the URL, e.g. "Cerrados", "Por responder"; `null` for Todos. */
export function filterChipLabel(status: InboxStatus | null): string | null {
  if (!status) return null
  return INBOX_FILTERS.find((filter) => filter.status === status)?.label ?? null
}

/** Bottom-right of an open card: "hace 2 min". */
export function formatLastInteraction(
  summary: Pick<CaseSummary, 'lastInteractionAt'>,
  now: DateInput,
): string {
  return formatRelativeTime(summary.lastInteractionAt, now)
}

/** Top right of a closed card: "hace 3 h", next to a clock (`closedAt` missing → null). */
export function formatClosedAgo(
  summary: Pick<CaseSummary, 'closedAt'>,
  now: DateInput,
): string | null {
  return summary.closedAt ? formatRelativeTime(summary.closedAt, now) : null
}

/** Small tag on a card that continues a closed case (contract §4.6). */
export const RETURNED_TAG = {
  label: 'Volvió a escribir',
  title: 'Escribió de nuevo después de que se cerró su caso anterior',
} as const

/** Empty list copy per filter (contract §9.1; slice 6: a filter reached from Inicio). */
export function emptyListCopy(filter: InboxStatus | null, searching: boolean): string {
  if (searching) return 'Ningún caso coincide con tu búsqueda.'
  switch (filter) {
    case 'closed':
      return 'No cerraste casos en los últimos 7 días.'
    case 'to_reply':
      return 'Ningún caso espera tu respuesta.'
    case 'new':
      return 'No tienes casos nuevos.'
    case 'waiting':
      return 'Ningún caso espera al cliente.'
    default:
      return 'Nada pendiente.'
  }
}

// ─── Search ──────────────────────────────────────────────────────────────────

/** Max length the API accepts for `q`. */
export const SEARCH_MAX_LENGTH = 80

/** What the API receives as `q`: trimmed, at most 80 chars, '' = no search. */
export function normalizeSearch(query: string): string {
  return query.trim().slice(0, SEARCH_MAX_LENGTH).trim()
}

// ─── Realtime freshness rules (contract §5.3) ────────────────────────────────

/** `inbox.counts`: apply when `computedAt` is at least the cached one. */
export function isNewerCounts(incoming: InboxCounts, cached: InboxCounts | undefined): boolean {
  if (!cached) return true
  return toMs(incoming.computedAt) >= toMs(cached.computedAt)
}

/** `case.updated`: apply only when `version` is newer than the cached one. */
export function isNewerCase(
  incoming: Pick<CaseSummary, 'version'>,
  cached: Pick<CaseSummary, 'version'> | undefined,
): boolean {
  return !cached || incoming.version > cached.version
}

/**
 * Fields that decide whether a case belongs to a filtered inbox and where it
 * sorts (server order: status group, then `lastInteractionAt`; Cerrados by
 * `closedAt`). `customer`, `openedAt` and `id` never change, so a search keeps
 * matching.
 */
const PLACEMENT_FIELDS = [
  'inboxStatus',
  'status',
  'lastInteractionAt',
  'assignedAnalystId',
  'closedAt',
] as const satisfies readonly (keyof CaseSummary)[]

/** True when `next` may leave, enter or move within an inbox compared to `previous`. */
export function changesInboxPlacement(previous: CaseSummary, next: CaseSummary): boolean {
  return PLACEMENT_FIELDS.some((field) => previous[field] !== next[field])
}

export interface InboxPatch {
  /** The inbox with the card replaced (the same object when nothing changed). */
  inbox: InboxResponse
  /** Membership or order may have changed: refetch this inbox (the server owns both). */
  refetch: boolean
}

/** Whether a case with `inboxStatus` belongs to the list of `filter` (Todos = open cases). */
export function fitsInboxFilter(
  inboxStatus: InboxStatus | null,
  filter: InboxStatus | null,
): boolean {
  if (inboxStatus === null) return false
  if (filter === null) return inboxStatus !== 'closed'
  return filter === inboxStatus
}

/**
 * `case.updated` / `case.assigned` applied to one cached inbox (filter `status`,
 * `null` = Todos). A newer card is patched in place; the inbox is refetched
 * only when the case may enter it (unknown id that fits the filter) or its
 * placement changed. Counters come with `inbox.counts`, never from here.
 */
export function patchInbox(
  inbox: InboxResponse,
  status: InboxStatus | null,
  summary: CaseSummary,
): InboxPatch {
  const index = inbox.items.findIndex((item) => item.id === summary.id)
  const cached = inbox.items[index]
  if (index < 0 || !cached) {
    return { inbox, refetch: fitsInboxFilter(summary.inboxStatus, status) }
  }
  if (!isNewerCase(summary, cached)) return { inbox, refetch: false }
  const items = inbox.items.slice()
  items[index] = summary
  return { inbox: { ...inbox, items }, refetch: changesInboxPlacement(cached, summary) }
}

// ─── Escalations to supervision (slice 9) ────────────────────────────────────
// Grounded in the dataset's `was_escalated` (yes/no) only: a motive and what supervision did.

/** The motive and the answer: at most this many characters (the backend's `MAX_ESCALATION_TEXT`). */
export const MAX_ESCALATION_TEXT = 500

/**
 * The "Escalado" marker next to a case's status (cards, Colas, the analyst sheet, the
 * supervisor header): a ring with an up arrow, orange. A marker, not a status: the case keeps
 * its own status.
 */
export const ESCALATED_MARKER: StatusAppearance = { shape: 'up', tone: 'warn', label: 'Escalado' }

/** What became of an escalation, as glyph + word (Linear-style; "Escalados"). */
export const ESCALATION_STATE: Readonly<Record<EscalationState, StatusAppearance>> = {
  open: { shape: 'ring', tone: 'warn', label: 'Abierto', strong: true },
  answered: { shape: 'check', tone: 'success', label: 'Respondido' },
  taken: { shape: 'pie-50', tone: 'accent', label: 'Tomado' },
  reassigned: { shape: 'forward', tone: 'neutral', label: 'Reasignado' },
  withdrawn: { shape: 'cross', tone: 'closed', label: 'Retirado' },
  closed: { shape: 'check', tone: 'closed', label: 'Caso cerrado' },
}

/** Supervision did something about it (answered, took or reassigned the case). */
export function isAttendedEscalation(state: EscalationState): boolean {
  return state === 'answered' || state === 'taken' || state === 'reassigned'
}

/**
 * Team-generated visual emphasis only (no deadline, no SLA): an open escalation waiting more
 * than 15 minutes shows an orange flame, more than 30 a filled red one.
 */
export const ESCALATION_WAIT_RISK_MS = 15 * MINUTE
export const ESCALATION_WAIT_LONG_MS = 30 * MINUTE

/** "6 min", "1 h 05 min": how long, in whole minutes (never seconds). */
function minutesText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${String(rest).padStart(2, '0')} min` : `${hours} h`
}

/**
 * "Esperando" of an escalation: open → time since it was escalated (clock; orange flame
 * > 15 min; filled red flame > 30 min); ended → how long it waited (clock, muted).
 */
export function escalationWaitFact(
  escalation: { escalatedAt: string; resolvedAt: string | null; state: EscalationState },
  now: DateInput,
): FactItem & { level: 'normal' | 'risk' | 'long' } {
  const end = escalation.state === 'open' ? toMs(now) : toMs(escalation.resolvedAt ?? now)
  const waited = end - toMs(escalation.escalatedAt)
  const text = minutesText(waited)
  if (escalation.state !== 'open') {
    return {
      key: 'wait',
      level: 'normal',
      icon: 'clock',
      tone: 'muted',
      text,
      label: 'Esperó',
      tooltip: `Esperó ${text}`,
    }
  }
  const tooltip = `Espera desde hace ${text}`
  if (waited > ESCALATION_WAIT_LONG_MS) {
    return {
      key: 'wait',
      level: 'long',
      icon: 'flame-filled',
      tone: 'danger',
      text,
      label: 'Espera',
      tooltip,
    }
  }
  if (waited > ESCALATION_WAIT_RISK_MS) {
    return {
      key: 'wait',
      level: 'risk',
      icon: 'flame',
      tone: 'warn',
      text,
      label: 'Espera',
      tooltip,
    }
  }
  return {
    key: 'wait',
    level: 'normal',
    icon: 'clock',
    tone: 'default',
    text,
    label: 'Espera',
    tooltip,
  }
}
