/**
 * Pure rules and copy of the case list (Workspace.dc.html; contract
 * docs/platform/api/slice-2-case-lifecycle.md §4.1–§4.5, §9.1). No React, no
 * I/O: unit-tested in model.test.ts.
 *
 * The words come from the `cases` catalog, read when a function runs or a label is read
 * (slice 23): the shared maps below (`CASE_STATUS`, `CASE_PRIORITY`, `CLOSE_REASONS`…) expose
 * their words as getters, so every area that shows them follows the UI language.
 */
import type { FactIcon, FactItem, FactTone, StatusAppearance, Tone } from '@/components/ui'
import { formatDuration, formatRelativeTime } from '@/lib/format'
import { i18n } from '@/lib/i18n'
import type {
  CaseChannel,
  CasePriority,
  CaseRating,
  CaseStatus,
  CaseType,
  CaseSummary,
  CloseReason,
  CountryCode,
  EscalationState,
  InboxCounts,
  InboxResponse,
  InboxStatus,
} from './types'

const t = i18n.getFixedT(null, 'cases')

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
  queued: statusConfig('queued', { shape: 'dashed', tone: 'neutral' }),
  new: statusConfig('new', { shape: 'ring', tone: 'accent' }),
  to_reply: statusConfig('to_reply', { shape: 'pie-75', tone: 'warn', strong: true }),
  waiting: statusConfig('waiting', { shape: 'pie-50', tone: 'waiting' }),
  closed: statusConfig('closed', { shape: 'check', tone: 'closed' }),
}

/** A status whose words are read from `cases:status.<key>` when shown. */
function statusConfig(
  key: CaseStatusKey,
  look: Omit<CaseStatusConfig, 'label' | 'bucket'>,
): CaseStatusConfig {
  return {
    ...look,
    get label() {
      return t(`status.${key}.label`)
    },
    get bucket() {
      return t(`status.${key}.bucket`)
    },
  }
}

/** A glyph whose word is read from the catalog when shown. */
function appearanceOf(
  look: Omit<StatusAppearance, 'label'>,
  label: () => string,
): StatusAppearance {
  return {
    ...look,
    get label() {
      return label()
    },
  }
}

/** A past case still open, outside any inbox view ("Casos anteriores"). */
export const OPEN_CASE_STATUS: StatusAppearance = appearanceOf(
  { shape: 'pie-25', tone: 'accent' },
  () => t('status.open'),
)

/** Slice 19: a case the virtual assistant holds (nobody's inbox, no queue, no SLA yet). */
export const WITH_ASSISTANT_STATUS: StatusAppearance = appearanceOf(
  { shape: 'bot', tone: 'accent' },
  () => t('status.withAssistant'),
)

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
  if (status === 'with_assistant') return WITH_ASSISTANT_STATUS
  return OPEN_CASE_STATUS
}

// ─── Filters (the status counters ARE the filters) ──────────────────────────

export interface InboxFilter {
  /** `null` = Todos; also the `?status=` value of "Casos" (the API `InboxStatus`). */
  status: InboxStatus | null
  label: string
  tone: Tone
}

const filterOf = (status: InboxStatus): InboxFilter => ({
  status,
  get label() {
    return CASE_STATUS[status].bucket
  },
  tone: CASE_STATUS[status].tone,
})

/** Canvas order: Todos · Por responder · Nuevos · Esperando al cliente · Cerrados. */
export const INBOX_FILTERS: readonly InboxFilter[] = [
  {
    status: null,
    get label() {
      return t('filters.all')
    },
    tone: 'neutral',
  },
  filterOf('to_reply'),
  filterOf('new'),
  filterOf('waiting'),
  filterOf('closed'),
]

/** A `?status=` value → the inbox status it filters by; unknown or absent → `null` (Todos). */
export function parseInboxStatus(value: string | null | undefined): InboxStatus | null {
  if (!value) return null
  return INBOX_FILTERS.find((filter) => filter.status === value)?.status ?? null
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
  chat_app: channelConfig({ value: 'chat_app', kind: 'chat', icon: 'message' }),
  chat_web: channelConfig({ value: 'chat_web', kind: 'chat', icon: 'message' }),
  phone_inbound: channelConfig({ value: 'phone_inbound', kind: 'phone', icon: 'phone-incoming' }),
  phone_outbound: channelConfig({ value: 'phone_outbound', kind: 'phone', icon: 'phone-outgoing' }),
  email: channelConfig({ value: 'email', kind: 'email', icon: 'mail' }),
}

/** A channel whose label is read from `cases:channel.<value>` when shown. */
function channelConfig(config: Omit<CaseChannelConfig, 'label'>): CaseChannelConfig {
  return {
    ...config,
    get label() {
      return t(`channel.${config.value}`)
    },
  }
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
  none: priorityConfig({ value: 'none', icon: 'priority-none', rank: 2 }),
  critical: priorityConfig({ value: 'critical', icon: 'priority-critical', rank: 0 }),
  high: priorityConfig({ value: 'high', icon: 'priority-high', rank: 1 }),
  medium: priorityConfig({ value: 'medium', icon: 'priority-medium', rank: 2 }),
  low: priorityConfig({ value: 'low', icon: 'priority-low', rank: 2 }),
}

/** A level whose words are read from `cases:priority.<value>` when shown. */
function priorityConfig(
  config: Omit<CasePriorityConfig, 'label' | 'longLabel'>,
): CasePriorityConfig {
  return {
    ...config,
    get label() {
      return t(`priority.${config.value}.label`)
    },
    get longLabel() {
      return t(`priority.${config.value}.long`)
    },
  }
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
  return t('priority.menuTrigger', { level: casePriority(priority).label })
}

/** Only critical and high show on a card (slice 8 UI rule): the rest is noise there. */
export function isUrgentPriority(priority: CasePriority): boolean {
  return priority === 'critical' || priority === 'high'
}

// ─── Case type (slice 18: the dataset's complaints.subcategory + "Sin tipo") ───

export interface CaseTypeConfig {
  value: CaseType
  /** The type as a value: "Cobro indebido", "Sin tipo" (ficha, menu, supervisor view). */
  label: string
}

/**
 * The one case-type map of the staff UI (slice 18, ADR 0006): the AI matures per case type.
 * The names are the dataset's complaint subcategories (`complaints.subcategory`, from
 * data-lab's aggregate report); "Tarjeta virtual" is team-generated (a new product the demo
 * shows maturing from zero). Menu order as Linear: none first, then the dataset's order by
 * share, then the team-generated one. Shown only while the AI switch is on.
 */
export const CASE_TYPE: Readonly<Record<CaseType, CaseTypeConfig>> = {
  none: caseTypeConfig('none'),
  unrecognized_charge: caseTypeConfig('unrecognized_charge'),
  undue_charge: caseTypeConfig('undue_charge'),
  app_issue: caseTypeConfig('app_issue'),
  branch_service: caseTypeConfig('branch_service'),
  service_quality: caseTypeConfig('service_quality'),
  // Team-generated: not a dataset subcategory.
  virtual_card: caseTypeConfig('virtual_card'),
}

/** A type whose label is read from `cases:caseType.<value>` when shown. */
function caseTypeConfig(value: CaseType): CaseTypeConfig {
  return {
    value,
    get label() {
      return t(`caseType.${value}`)
    },
  }
}

/** The options of the case-type menu, in menu order. */
export const CASE_TYPE_OPTIONS: readonly CaseTypeConfig[] = Object.values(CASE_TYPE)

/** The config of a type (an unknown value reads as "Sin tipo"). */
export function caseType(value: CaseType): CaseTypeConfig {
  return CASE_TYPE[value] ?? CASE_TYPE.none
}

/** The trigger of the case-type menu: the value, then what it does. */
export function caseTypeMenuLabel(value: CaseType): string {
  return t('caseType.menuTrigger', { type: caseType(value).label })
}

const COUNTRIES: readonly CountryCode[] = ['CO', 'MX', 'AR', 'BR']

/** "Colombia", "México"… (an unknown code reads as itself). */
export function countryName(country: CountryCode): string {
  return COUNTRIES.includes(country) ? t(`country.${country}`) : country
}

/** The channel as an icon-only fact: the icon, the label as tooltip and accessible text. */
export function channelFact(channel: CaseChannel): FactItem {
  const config = caseChannel(channel)
  return {
    key: 'channel',
    icon: config.icon,
    text: config.label,
    label: t('channel.fact'),
    iconOnly: true,
  }
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
      ? {
          key: 'call',
          icon: 'phone',
          text: t('card.callInProgress'),
          tone: 'success',
          iconOnly: true,
        }
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
  closeReason('resolved', 'success'),
  closeReason('customer_unresponsive', 'closed'),
  closeReason('duplicate', 'accent'),
  closeReason('out_of_scope', 'warn'),
  closeReason('other', 'neutral'),
]

/** A reason whose words are read from `cases:closeReason.<value>` when shown. */
function closeReason(value: CloseReason, tone: Tone): CloseReasonOption {
  return {
    value,
    get label() {
      return t(`closeReason.${value}.label`)
    },
    get meaning() {
      return t(`closeReason.${value}.meaning`)
    },
    tone,
  }
}

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
  if (!reason) return t('closeReason.none')
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
  ratingStep('poor', { score: 1, icon: 'frown', tone: 'danger', textTone: 'danger' }),
  ratingStep('fair', { score: 2, icon: 'meh', tone: 'warn', textTone: 'warn' }),
  ratingStep('good', { score: 3, icon: 'smile', tone: 'success', textTone: 'success' }),
  ratingStep('excellent', { score: 4, icon: 'laugh', tone: 'success', textTone: 'success' }),
]

/** A score whose word is read from `cases:rating.<word>` when shown. */
function ratingStep(
  word: 'poor' | 'fair' | 'good' | 'excellent',
  option: Omit<RatingOption, 'label'>,
): RatingOption {
  return {
    ...option,
    get label() {
      return t(`rating.${word}`)
    },
  }
}

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
    text: t('rating.fact', { label: option.label }),
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
  if (remaining <= 0) return { text: t('sla.overdueTag'), atRisk }
  return { text: t('sla.tag', { time: remainingText(remaining) }), atRisk }
}

/** How close the first-response SLA is: past due, at risk (≤ 5 min), or running. */
export type SlaLevel = 'overdue' | 'at_risk' | 'normal'

/** "12 min", "5 h", "2 días": the time left, without the word "SLA". */
function remainingText(remainingMs: number): string {
  if (remainingMs < HOUR) return t('time.minutes', { count: Math.ceil(remainingMs / MINUTE) })
  if (remainingMs < 2 * DAY) return t('time.hours', { count: Math.floor(remainingMs / HOUR) })
  return t('time.days', { count: Math.floor(remainingMs / DAY) })
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
  const label = t('sla.label')
  if (remaining <= 0) {
    return {
      key: 'sla',
      level: 'overdue',
      icon: 'flame-filled',
      tone: 'danger',
      text: t('sla.overdue'),
      label,
      tooltip: t('sla.overdueTooltip'),
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
        tooltip: t('sla.atRiskTooltip', { time: left }),
      }
    : {
        key: 'sla',
        level: 'normal',
        icon: 'clock',
        tone: 'muted',
        text: left,
        label,
        tooltip: t('sla.runningTooltip', { time: left }),
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
  return {
    label: t(`availability.${status}.label`),
    detail: t(`availability.${status}.detail`),
    accessibleName: t(`availability.${status}.accessibleName`),
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
export const RETURNED_TAG: { readonly label: string; readonly title: string } = {
  get label() {
    return t('returned.label')
  },
  get title() {
    return t('returned.title')
  },
}

/** Empty list copy per filter (contract §9.1; slice 6: a filter reached from Inicio). */
export function emptyListCopy(filter: InboxStatus | null, searching: boolean): string {
  if (searching) return t('empty.searching')
  return t(`empty.${filter ?? 'all'}`)
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
export const ESCALATED_MARKER: StatusAppearance = appearanceOf({ shape: 'up', tone: 'warn' }, () =>
  t('escalation.marker'),
)

/** What became of an escalation, as glyph + word (Linear-style; "Escalados"). */
export const ESCALATION_STATE: Readonly<Record<EscalationState, StatusAppearance>> = {
  open: escalationState('open', { shape: 'ring', tone: 'warn', strong: true }),
  answered: escalationState('answered', { shape: 'check', tone: 'success' }),
  taken: escalationState('taken', { shape: 'pie-50', tone: 'accent' }),
  reassigned: escalationState('reassigned', { shape: 'forward', tone: 'neutral' }),
  withdrawn: escalationState('withdrawn', { shape: 'cross', tone: 'closed' }),
  closed: escalationState('closed', { shape: 'check', tone: 'closed' }),
}

function escalationState(
  state: EscalationState,
  look: Omit<StatusAppearance, 'label'>,
): StatusAppearance {
  return appearanceOf(look, () => t(`escalation.state.${state}`))
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
  return formatDuration(Math.max(0, Math.floor(ms / MINUTE)))
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
      label: t('escalation.waited'),
      tooltip: t('escalation.waitedTooltip', { time: text }),
    }
  }
  const tooltip = t('escalation.waitingTooltip', { time: text })
  const label = t('escalation.waiting')
  if (waited > ESCALATION_WAIT_LONG_MS) {
    return {
      key: 'wait',
      level: 'long',
      icon: 'flame-filled',
      tone: 'danger',
      text,
      label,
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
      label,
      tooltip,
    }
  }
  return {
    key: 'wait',
    level: 'normal',
    icon: 'clock',
    tone: 'default',
    text,
    label,
    tooltip,
  }
}
