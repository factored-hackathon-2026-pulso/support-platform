/**
 * Pure rules and copy of the case list (Workspace.dc.html; contract
 * docs/platform/api/slice-2-case-lifecycle.md §4.1–§4.5, §9.1). No React, no
 * I/O: unit-tested in model.test.ts.
 */
import type { FactItem, Tone } from '@/components/ui'
import { formatRelativeTime } from '@/lib/format'
import type {
  CaseChannel,
  CasePriority,
  CaseSummary,
  CloseReason,
  CountryCode,
  InboxCounts,
  InboxResponse,
  InboxStatus,
} from './types'

// ─── Filters (the status counters ARE the filters) ──────────────────────────

export interface InboxFilter {
  /** `null` = Todos. */
  status: InboxStatus | null
  label: string
  /** URL slug (`?estado=`); `null` for Todos (no param). */
  slug: string | null
  tone: Tone
}

/** Canvas order: Todos · Por responder · Nuevos · Esperando al cliente · Cerrados. */
export const INBOX_FILTERS: readonly InboxFilter[] = [
  { status: null, label: 'Todos', slug: null, tone: 'neutral' },
  { status: 'to_reply', label: 'Por responder', slug: 'por-responder', tone: 'warn' },
  { status: 'new', label: 'Nuevos', slug: 'nuevos', tone: 'accent' },
  { status: 'waiting', label: 'Esperando al cliente', slug: 'esperando', tone: 'waiting' },
  { status: 'closed', label: 'Cerrados', slug: 'cerrados', tone: 'closed' },
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

/** Bucket, sub-label and tone of a case (contract §4.1, §9.1). */
export function inboxStatusMeta(summary: Pick<CaseSummary, 'inboxStatus'>): InboxStatusMeta {
  switch (summary.inboxStatus) {
    case 'new':
      return { label: 'Nuevos', subLabel: 'Nuevo', tone: 'accent' }
    case 'to_reply':
      return { label: 'Por responder', subLabel: 'Por responder', tone: 'warn' }
    case 'waiting':
      return {
        label: 'Esperando al cliente',
        subLabel: 'Esperando al cliente',
        tone: 'waiting',
      }
    case 'closed':
      return { label: 'Cerrados', subLabel: 'Cerrado', tone: 'closed' }
    default:
      // `null`: queued, in no analyst inbox yet (supervision's queue, slice 3).
      return { label: 'Sin asignar', subLabel: 'En la cola', tone: 'neutral' }
  }
}

// ─── Labels ──────────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<CaseChannel, string> = {
  app_chat: 'App',
  web_chat: 'Web',
}

/** Card line: "App", "Web". */
export function channelLabel(channel: CaseChannel): string {
  return CHANNEL_LABELS[channel] ?? channel
}

const CHANNEL_PHRASES: Record<CaseChannel, string> = {
  app_chat: 'chat en la app',
  web_chat: 'chat web',
}

/** Header meta: "chat en la app", "chat web". */
export function channelPhrase(channel: CaseChannel): string {
  return CHANNEL_PHRASES[channel] ?? channel
}

const PRIORITY_LABELS: Record<CasePriority, string> = {
  low: 'Prioridad baja',
  medium: 'Prioridad media',
  high: 'Prioridad alta',
}

export function priorityLabel(priority: CasePriority): string {
  return PRIORITY_LABELS[priority] ?? priority
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

/** The channel as a fact: [smartphone] App · [globe] Web. */
export function channelFact(channel: CaseChannel): FactItem {
  return {
    key: 'channel',
    icon: channel === 'app_chat' ? 'smartphone' : 'globe',
    text: channelLabel(channel),
    label: 'Canal',
    iconOnly: true,
  }
}

/** Priority is shown only when it is high (slice 6 UI rule): [flag] Prioridad alta. */
export function priorityFact(priority: CasePriority): FactItem | null {
  return priority === 'high'
    ? { key: 'priority', icon: 'flag', text: priorityLabel(priority), tone: 'warn', iconOnly: true }
    : null
}

/**
 * The facts of an open card's bottom line (slice 6 UI rule: one fact each, no
 * dot-joined line): channel, priority when high, "Volvió a escribir".
 * The status is a pill and the time its own element (CaseCard).
 */
export function caseCardFacts(
  summary: Pick<CaseSummary, 'channel' | 'priority' | 'previousCaseId'>,
): FactItem[] {
  const facts: (FactItem | null)[] = [
    channelFact(summary.channel),
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
 * Urgency group of a case at `now` (lower = sooner): 0 first-response SLA overdue
 * or at risk (≤ 5 min), 1 SLA still running, 2 the customer waits without an SLA
 * (Nuevo / Por responder after the first reply), 3 Esperando al cliente, 4 closed.
 */
export function urgencyGroup(
  summary: Pick<CaseSummary, 'status' | 'inboxStatus' | 'slaDueAt' | 'firstResponseAt'>,
  now: DateInput,
): number {
  if (summary.status === 'closed') return 4
  if (summary.inboxStatus === 'waiting') return 3
  if (summary.firstResponseAt) return 2
  return toMs(summary.slaDueAt) - toMs(now) <= SLA_AT_RISK_MS ? 0 : 1
}

type UrgencyFields = Pick<
  CaseSummary,
  'id' | 'status' | 'inboxStatus' | 'slaDueAt' | 'firstResponseAt' | 'lastInteractionAt'
>

/**
 * The one urgency order of open cases (Inicio's "Lo primero" and the Casos list):
 * SLA overdue or at risk first, then the nearest `slaDueAt`, then whoever has
 * waited longest without an SLA, Esperando al cliente last; ties by id.
 */
export function compareByUrgency(a: UrgencyFields, b: UrgencyFields, now: DateInput): number {
  const group = urgencyGroup(a, now) - urgencyGroup(b, now)
  if (group !== 0) return group
  const bySla = urgencyGroup(a, now) <= 1
  const key = (item: UrgencyFields) => toMs(bySla ? item.slaDueAt : item.lastInteractionAt)
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

export interface ToastCopy {
  title: string
  description: string
  /** A small pill on the toast ("Supervisión"), never joined to the description. */
  tag?: string
}

/**
 * Toast on `case.assigned` (slice 2 §9.1). A case a supervisor gave her
 * (`fromSupervisor`: the envelope actor is a supervisor, slice 3 §8.3) says so:
 * "Te asignaron un caso", the customer, and the "Supervisión" tag (slice 6: no
 * dot-joined description).
 */
export function assignedToastCopy(
  summary: Pick<CaseSummary, 'previousCaseId' | 'customer'>,
  { fromSupervisor = false }: { fromSupervisor?: boolean } = {},
): ToastCopy {
  const name = summary.customer.displayName
  if (fromSupervisor) {
    return { title: 'Te asignaron un caso', description: name, tag: 'Supervisión' }
  }
  if (summary.previousCaseId) {
    const first = name.trim().split(/\s+/)[0] ?? name
    return { title: `${first} volvió a escribir`, description: name }
  }
  return { title: 'Te llegó un caso nuevo', description: name }
}

/**
 * Toast on `case.unassigned`: supervision gave one of her cases to someone else
 * (slice 3 §8.3). "leerlo" refers to "el caso", named in the same sentence.
 */
export function unassignedToastCopy(summary: Pick<CaseSummary, 'customer'>): ToastCopy {
  return {
    title: 'Supervisión reasignó un caso',
    description: `El caso de ${summary.customer.displayName} pasó a otra persona del equipo. Puedes leerlo, pero ya no responder.`,
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
