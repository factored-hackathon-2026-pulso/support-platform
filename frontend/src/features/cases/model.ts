/**
 * Pure rules and copy of the case list (Workspace.dc.html, contract §1.4–§1.5,
 * §7.1). No React, no I/O: unit-tested in model.test.ts.
 */
import type { Tone } from '@/components/ui'
import { formatRelativeTime, formatTimer } from '@/lib/format'
import type {
  CaseChannel,
  CasePriority,
  CaseSummary,
  CaseTopic,
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

/** Canvas order: Todos · Por responder · En curso · Nuevos · Por llamar · En espera. */
export const INBOX_FILTERS: readonly InboxFilter[] = [
  { status: null, label: 'Todos', slug: null, tone: 'neutral' },
  { status: 'to_reply', label: 'Por responder', slug: 'por-responder', tone: 'warn' },
  { status: 'live', label: 'En curso', slug: 'en-curso', tone: 'success' },
  { status: 'new', label: 'Nuevos', slug: 'nuevos', tone: 'accent' },
  { status: 'to_call', label: 'Por llamar', slug: 'por-llamar', tone: 'callout' },
  { status: 'waiting', label: 'En espera', slug: 'en-espera', tone: 'waiting' },
]

/** `?estado=` slug → status; unknown or absent → `null` (Todos). */
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
  live: 'live',
  to_call: 'toCall',
  waiting: 'waiting',
}

/** Count shown on a filter tile. */
export function countForFilter(counts: InboxCounts, status: InboxStatus | null): number {
  return status ? counts[COUNT_FIELD[status]] : counts.all
}

// ─── Status meta ─────────────────────────────────────────────────────────────

export interface InboxStatusMeta {
  /** Tile / bucket name: "Por responder". */
  label: string
  /** Card `title` and collapsed-rail name: "Esperando al cliente", "En llamada"… */
  subLabel: string
  tone: Tone
}

/** Canvas bucket, sub-label and tone of a case (contract §1.4). */
export function inboxStatusMeta(
  summary: Pick<CaseSummary, 'inboxStatus' | 'status'>,
): InboxStatusMeta {
  switch (summary.inboxStatus) {
    case 'new':
      return { label: 'Nuevos', subLabel: 'Nuevo', tone: 'accent' }
    case 'to_reply':
      return { label: 'Por responder', subLabel: 'Por responder', tone: 'warn' }
    case 'live':
      return { label: 'En curso', subLabel: 'En llamada', tone: 'success' }
    case 'to_call':
      return { label: 'Por llamar', subLabel: 'Por llamar', tone: 'callout' }
    case 'waiting':
      return {
        label: 'En espera',
        subLabel:
          summary.status === 'awaiting_approval' ? 'Esperando aprobación' : 'Esperando al cliente',
        tone: 'waiting',
      }
    default:
      // Not in any inbox (routing, queued, closed).
      return summary.status === 'closed'
        ? { label: 'Cerrado', subLabel: 'Cerrado', tone: 'neutral' }
        : { label: 'Sin asignar', subLabel: 'Buscando a quién asignarlo', tone: 'neutral' }
  }
}

// ─── Labels ──────────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<CaseChannel, string> = {
  app_chat: 'App',
  web_chat: 'Web',
  phone: 'Teléfono',
  email: 'Correo',
}

/** Card line: "App", "Web", "Teléfono", "Correo". */
export function channelLabel(channel: CaseChannel): string {
  return CHANNEL_LABELS[channel] ?? channel
}

const CHANNEL_PHRASES: Record<CaseChannel, string> = {
  app_chat: 'chat en la app',
  web_chat: 'chat web',
  phone: 'teléfono',
  email: 'correo',
}

/** Header meta: "chat en la app", "chat web", "teléfono", "correo". */
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

const TOPIC_LABELS: Record<CaseTopic, string> = {
  disputar_cargo: 'Cargo no reconocido',
  cobro_duplicado: 'Cobro duplicado',
  consultar_cargo: 'Consulta de un cargo',
  consultar_movimientos: 'Consulta de movimientos',
  estado_disputa: 'Estado de la disputa',
  fraude_urgente: 'Fraude urgente',
  hablar_con_humano: 'Pide una persona',
  fuera_de_alcance: 'Fuera de alcance',
  problema_app: 'Problema con la app',
}

/** Request type; `null` (no judge connected yet) → "Sin clasificar". */
export function topicLabel(topic: CaseTopic | null | undefined): string {
  if (!topic) return 'Sin clasificar'
  return TOPIC_LABELS[topic] ?? topic
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

/** Card bottom line: "Prioridad media · Web · Cargo no reconocido". */
export function caseCardLine(summary: Pick<CaseSummary, 'priority' | 'channel' | 'topic'>): string {
  return [
    priorityLabel(summary.priority),
    channelLabel(summary.channel),
    topicLabel(summary.topic),
  ].join(' · ')
}

// ─── SLA and last interaction (contract §1.5) ────────────────────────────────

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** Remaining time at or under this is shown in orange. */
export const SLA_AT_RISK_MS = 15 * MINUTE

export interface SlaDisplay {
  text: string
  atRisk: boolean
}

type DateInput = Date | string | number

const toMs = (value: DateInput) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime()

/**
 * "SLA x" at the top right of a card, from the server's `slaDueAt` and the real
 * clock: "SLA 9 min", "SLA 5 h", "SLA 2 días", "SLA vencido"; a live call shows
 * its timer instead ("En llamada · 04:06").
 */
export function formatSla(
  summary: Pick<CaseSummary, 'status' | 'slaDueAt' | 'liveSince'>,
  now: DateInput,
): SlaDisplay {
  const nowMs = toMs(now)
  if (summary.status === 'in_call') {
    if (!summary.liveSince) return { text: 'En llamada', atRisk: false }
    return {
      text: `En llamada · ${formatTimer((nowMs - toMs(summary.liveSince)) / 1000)}`,
      atRisk: false,
    }
  }
  const remaining = toMs(summary.slaDueAt) - nowMs
  const atRisk = remaining <= SLA_AT_RISK_MS
  if (remaining <= 0) return { text: 'SLA vencido', atRisk }
  if (remaining < HOUR) return { text: `SLA ${Math.ceil(remaining / MINUTE)} min`, atRisk }
  if (remaining < 2 * DAY) return { text: `SLA ${Math.floor(remaining / HOUR)} h`, atRisk }
  return { text: `SLA ${Math.floor(remaining / DAY)} días`, atRisk }
}

/** Bottom-right of a card: "hace 2 min"; a live call is "ahora". */
export function formatLastInteraction(
  summary: Pick<CaseSummary, 'status' | 'lastInteractionAt'>,
  now: DateInput,
): string {
  if (summary.status === 'in_call') return 'ahora'
  return formatRelativeTime(summary.lastInteractionAt, now)
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
 * sorts (server `inbox_order`: live first by `liveSince`, then `slaDueAt`).
 * `customer`, `openedAt` and `id` never change, so a search keeps matching.
 */
const PLACEMENT_FIELDS = [
  'inboxStatus',
  'status',
  'slaDueAt',
  'liveSince',
  'assignedAnalystId',
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
    const fits = summary.inboxStatus !== null && (status === null || status === summary.inboxStatus)
    return { inbox, refetch: fits }
  }
  if (!isNewerCase(summary, cached)) return { inbox, refetch: false }
  const items = inbox.items.slice()
  items[index] = summary
  return { inbox: { ...inbox, items }, refetch: changesInboxPlacement(cached, summary) }
}
