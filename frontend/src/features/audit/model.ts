/**
 * Pure rules and copy of the audit screen (SuAudit.dc.html, contract
 * docs/platform/api/slice-3-supervision.md §5, §8.8–§8.9): the filters (their URL
 * state is in url.ts), the API query they become (dates in the viewer's zone →
 * UTC instants), how each event row reads (who, kind badge, day separators,
 * times) and the detail aside. No React, no I/O: unit-tested in model.test.ts. Copy comes
 * from the `audit` catalog, read when a function runs (the UI language of that moment).
 */
import { ROLE_LABEL } from '@/app/roles'
import type { Tone } from '@/components/ui'
import { formatDate, formatTime, localDayKey } from '@/lib/format'
import { i18n } from '@/lib/i18n'
import type {
  ActorRole,
  AuditActor,
  AuditActorKind,
  AuditEvent,
  AuditFamily,
  AuditQuery,
} from './types'
import type { AuditUrlState } from './url'

const t = i18n.getFixedT(null, 'audit')

type DateInput = Date | string | number

// ── Filters ─────────────────────────────────────────────────────────────────

export interface KindFilterOption {
  /** `null` = Todos. */
  value: AuditActorKind | null
  /** In the active UI language (read on access). */
  readonly label: string
}

function kindFilter(value: AuditActorKind | null): KindFilterOption {
  return {
    value,
    get label() {
      return t(`filters.kind.${value ?? 'all'}`)
    },
  }
}

/** "Quién" pills: Todos, Equipo, Clientes, Plataforma. */
export const AUDIT_KIND_FILTERS: readonly KindFilterOption[] = [
  kindFilter(null),
  kindFilter('staff'),
  kindFilter('customer'),
  kindFilter('system'),
]

export interface FamilyOption {
  value: AuditFamily
  /** In the active UI language (read on access). */
  readonly label: string
}

function familyOption(value: AuditFamily): FamilyOption {
  return {
    value,
    get label() {
      return t(`families.${value}`)
    },
  }
}

/** "Tipo" options (the catalog families, slice 3 §5.3 + slice 4 §7.1). */
export const AUDIT_FAMILIES: readonly FamilyOption[] = [
  familyOption('conversation'),
  familyOption('assignment'),
  familyOption('lifecycle'),
  familyOption('availability'),
  familyOption('access'),
  familyOption('administration'),
  // Slice 9: escalations to supervision (motive and answer redacted).
  familyOption('escalation'),
  // Slice 16 (the agent builder) and 21 (the AI stages per case type).
  familyOption('agents'),
  familyOption('other'),
]

export function familyLabel(family: AuditFamily): string {
  return AUDIT_FAMILIES.find((option) => option.value === family)?.label ?? family
}

/** Max length of `q` (the API accepts 1–80). */
export const AUDIT_SEARCH_MAX_LENGTH = 80

// ── URL state (parse + serialize in url.ts) ──────────────────────────────────

export const EMPTY_AUDIT_STATE: AuditUrlState = {
  actorKind: null,
  actorId: null,
  caseId: null,
  family: null,
  fromDate: null,
  toDate: null,
  query: '',
  changesOnly: false,
  eventId: null,
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar day written as YYYY-MM-DD (rejects "2026-02-30"). */
export function isDateKey(value: string | null | undefined): value is string {
  const match = value ? DATE_KEY.exec(value) : null
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

/** Any filter set (the selected event is not a filter). */
export function hasAuditFilters(state: AuditUrlState): boolean {
  return (
    state.actorKind !== null ||
    state.actorId !== null ||
    state.caseId !== null ||
    state.family !== null ||
    state.fromDate !== null ||
    state.toDate !== null ||
    state.query.trim() !== '' ||
    state.changesOnly
  )
}

/** "Limpiar filtros": every filter back to its default; the selected event stays. */
export function clearAuditFilters(state: AuditUrlState): AuditUrlState {
  return { ...EMPTY_AUDIT_STATE, eventId: state.eventId }
}

/** The "Persona" filter only makes sense for staff (Todos or Equipo). */
export function showsPersonFilter(state: Pick<AuditUrlState, 'actorKind'>): boolean {
  return state.actorKind === null || state.actorKind === 'staff'
}

/** Changing "Quién" to customers or the platform drops the person filter. */
export function withActorKind(
  state: AuditUrlState,
  actorKind: AuditActorKind | null,
): AuditUrlState {
  const next = { ...state, actorKind }
  return showsPersonFilter(next) ? next : { ...next, actorId: null }
}

/** Inline error of "Hasta" when it is before "Desde" (no request is sent). */
export function dateRangeError(state: Pick<AuditUrlState, 'fromDate' | 'toDate'>): string | null {
  if (state.fromDate && state.toDate && state.toDate < state.fromDate) {
    return t('filters.rangeError')
  }
  return null
}

/** Start of a calendar day in the viewer's zone, as a UTC instant. */
export function startOfLocalDay(dateKey: string, dayOffset = 0): string {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, day + dayOffset).toISOString()
}

/**
 * URL state → GET /audit/events query: `from` = start of Desde, `to` = start
 * of the day after Hasta (so Hasta is inclusive), both in the viewer's zone
 * and sent as UTC; empty filters left out.
 */
export function auditFiltersOf(state: AuditUrlState): AuditQuery {
  const query: AuditQuery = {}
  if (state.actorKind) query.actorKind = state.actorKind
  if (state.actorId && showsPersonFilter(state)) query.actorId = state.actorId
  if (state.caseId) query.caseId = state.caseId
  if (state.family) query.family = state.family
  if (state.changesOnly) query.changesOnly = true
  if (state.fromDate) query.from = startOfLocalDay(state.fromDate)
  if (state.toDate) query.to = startOfLocalDay(state.toDate, 1)
  const q = state.query.trim().slice(0, AUDIT_SEARCH_MAX_LENGTH)
  if (q) query.q = q
  return query
}

// ── Rows ────────────────────────────────────────────────────────────────────

/** Kind badge of the "Quién" column: staff roles by their shared name (`shell:roles`), the
 * customer, the platform and (slice 19) agent-core's assistant by the name staff see. */
export function actorRoleLabel(role: ActorRole): string {
  switch (role) {
    case 'analyst':
    case 'supervisor':
    case 'admin':
      return ROLE_LABEL[role]
    case 'customer':
    case 'system':
    case 'assistant':
      return t(`actor.${role}`)
    default:
      return role
  }
}

/** Staff in the warm tone of the canvas "Persona" chip, customers in accent, the platform and the assistant neutral. */
export function actorTone(role: ActorRole): Tone {
  if (role === 'customer') return 'accent'
  if (role === 'system' || role === 'assistant') return 'neutral'
  return 'warn'
}

/**
 * Whether the row shows a name next to the badge: the platform and the assistant are named by
 * their badge alone (the assistant's agent reference stays in the detail's "Quién").
 */
export function showsActorName(role: ActorRole): boolean {
  return role !== 'system' && role !== 'assistant'
}

/** The name next to the badge: the person, "Plataforma", or the id when no name is known. */
export function actorName(actor: AuditActor): string {
  if (actor.role === 'system') return t('actor.system')
  return actor.name ?? actor.id
}

/** "11:02:05" in the viewer's zone. */
export function eventTime(value: DateInput): string {
  return formatTime(value, { withSeconds: true })
}

/** "5 mar 2026, 11:02:05" (detail aside). */
export function eventInstant(value: DateInput): string {
  return `${formatDate(value)}, ${eventTime(value)}`
}

/** Day separator: "Hoy", "Ayer", "3 mar" (another year: "28 dic 2025"). */
export function dayLabel(value: DateInput, now: DateInput): string {
  const day = localDayKey(value)
  if (day === localDayKey(now)) return t('log.today')
  const yesterday = new Date(new Date(now).getTime())
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === localDayKey(yesterday)) return t('log.yesterday')
  const sameYear = day.slice(0, 4) === localDayKey(now).slice(0, 4)
  return formatDate(value, { withYear: !sameYear })
}

export interface AuditDayGroup {
  /** Unique render key: the day plus the group's first event id. The log is in `sequence`
   * order, which is not always time order (an event recorded late, a clock skew), so the
   * same day can head two separate runs. */
  key: string
  /** YYYY-MM-DD in the viewer's zone. */
  day: string
  label: string
  events: AuditEvent[]
}

/** Events (newest first) grouped under their day separators, keeping the log order: a new
 * separator whenever the day changes between consecutive rows. */
export function groupByDay(events: readonly AuditEvent[], now: DateInput): AuditDayGroup[] {
  const groups: AuditDayGroup[] = []
  for (const event of events) {
    const day = localDayKey(event.occurredAt)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.events.push(event)
    else
      groups.push({
        key: `${day}:${event.id}`,
        day,
        label: dayLabel(event.occurredAt, now),
        events: [event],
      })
  }
  return groups
}

/** "Mostrando 51 eventos". */
export function shownCountLabel(count: number): string {
  return t('log.shown', { count })
}

/** Empty log: nothing at all, or nothing for these filters. */
export function emptyLogCopy(filtered: boolean): string {
  return filtered ? t('log.emptyFiltered') : t('log.empty')
}

// ── Detail aside ─────────────────────────────────────────────────────────────

/** Kicker parts, shown as separate elements (never " · " joined): "11:02:05", "ASIGNACIÓN". */
export interface DetailKicker {
  time: string
  family: string
}

export function detailKicker(event: Pick<AuditEvent, 'occurredAt' | 'family'>): DetailKicker {
  return { time: eventTime(event.occurredAt), family: familyLabel(event.family).toUpperCase() }
}

/** Byline parts: the name and the role word apart ("Lucía Herrera", "Supervisión"); the
 * platform is just "Plataforma" (no role). */
export interface DetailByline {
  name: string
  role: string | null
}

export function detailByline(actor: AuditActor): DetailByline {
  if (actor.role === 'system') return { name: t('actor.system'), role: null }
  if (actor.role === 'assistant') return { name: actorRoleLabel('assistant'), role: null }
  return { name: actorName(actor), role: actorRoleLabel(actor.role) }
}

export interface PayloadLine {
  key: string
  value: string
}

/** "Datos del evento": one line per key (snake_case as stored), JSON for nested values. */
export function payloadLines(payload: Record<string, unknown>): PayloadLine[] {
  return Object.entries(payload).map(([key, value]) => ({
    key,
    value:
      value === null
        ? 'null'
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value as string | number | boolean),
  }))
}

/** The message text was removed by the PII policy (§5.4): it lives in the conversation. */
export function hidesMessageText(event: Pick<AuditEvent, 'redactedFields'>): boolean {
  return event.redactedFields.includes('text')
}

/**
 * The note under "Datos del evento" for what the PII policy removed, or null: the message
 * text; slice 7, the customer's rating comment (`case.rated`); slice 9, an escalation's
 * motive and supervision's answer (staff text, redacted too).
 */
export function redactionNote(event: Pick<AuditEvent, 'redactedFields'>): string | null {
  if (hidesMessageText(event)) return t('redacted.text')
  if (event.redactedFields.includes('comment')) return t('redacted.comment')
  if (event.redactedFields.includes('motive')) return t('redacted.motive')
  if (event.redactedFields.includes('note')) return t('redacted.note')
  return null
}

// ── Persona filter ───────────────────────────────────────────────────────────

/** "Persona" option: active and inactive staff, the inactive ones marked "(desactivada)". */
export function personOptionLabel(person: { name: string; active: boolean }): string {
  return person.active ? person.name : t('filters.inactivePerson', { name: person.name })
}
