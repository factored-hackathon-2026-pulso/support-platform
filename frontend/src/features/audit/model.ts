/**
 * Pure rules and copy of the audit screen (SuAudit.dc.html, contract
 * docs/platform/api/slice-3-supervision.md §5, §8.8–§8.9): the filters (their URL
 * state is in url.ts), the API query they become (dates in the viewer's zone →
 * UTC instants), how each event row reads (who, kind badge, day separators,
 * times) and the detail aside. No React, no I/O: unit-tested in model.test.ts.
 */
import type { Tone } from '@/components/ui'
import { formatDate, formatTime, localDayKey } from '@/lib/format'
import type {
  ActorRole,
  AuditActor,
  AuditActorKind,
  AuditEvent,
  AuditFamily,
  AuditQuery,
} from './types'
import type { AuditUrlState } from './url'

type DateInput = Date | string | number

// ── Filters ─────────────────────────────────────────────────────────────────

export interface KindFilterOption {
  /** `null` = Todos. */
  value: AuditActorKind | null
  label: string
}

/** "Quién" pills: Todos · Equipo · Clientes · Plataforma. */
export const AUDIT_KIND_FILTERS: readonly KindFilterOption[] = [
  { value: null, label: 'Todos' },
  { value: 'staff', label: 'Equipo' },
  { value: 'customer', label: 'Clientes' },
  { value: 'system', label: 'Plataforma' },
]

export interface FamilyOption {
  value: AuditFamily
  label: string
}

/** "Tipo" options (the catalog families, slice 3 §5.3 + slice 4 §7.1). */
export const AUDIT_FAMILIES: readonly FamilyOption[] = [
  { value: 'conversation', label: 'Conversación' },
  { value: 'assignment', label: 'Asignación' },
  { value: 'lifecycle', label: 'Ciclo del caso' },
  { value: 'availability', label: 'Disponibilidad' },
  { value: 'access', label: 'Accesos' },
  { value: 'administration', label: 'Administración' },
  // Slice 9: escalations to supervision (motive and answer redacted).
  { value: 'escalation', label: 'Escalamientos' },
  { value: 'other', label: 'Otros' },
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
    return 'Debe ser el mismo día de «Desde» o uno posterior.'
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

const ROLE_LABELS: Record<ActorRole, string> = {
  analyst: 'Analista',
  supervisor: 'Supervisión',
  admin: 'Administración',
  customer: 'Cliente',
  system: 'Plataforma',
  assistant: 'Asistente',
}

/** Kind badge of the "Quién" column. */
export function actorRoleLabel(role: ActorRole): string {
  return ROLE_LABELS[role] ?? role
}

/** Staff in the warm tone of the canvas "Persona" chip, customers in accent, the platform and the assistant neutral. */
export function actorTone(role: ActorRole): Tone {
  if (role === 'customer') return 'accent'
  if (role === 'system' || role === 'assistant') return 'neutral'
  return 'warn'
}

/** The name next to the badge: the person, "Plataforma", or the id when no name is known. */
export function actorName(actor: AuditActor): string {
  if (actor.role === 'system') return 'Plataforma'
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
  if (day === localDayKey(now)) return 'Hoy'
  const yesterday = new Date(new Date(now).getTime())
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === localDayKey(yesterday)) return 'Ayer'
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
  return count === 1 ? 'Mostrando 1 evento' : `Mostrando ${count} eventos`
}

/** Empty log: nothing at all, or nothing for these filters. */
export function emptyLogCopy(filtered: boolean): string {
  return filtered ? 'Ningún evento coincide con estos filtros.' : 'Todavía no hay eventos.'
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
  if (actor.role === 'system') return { name: 'Plataforma', role: null }
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

export const REDACTED_TEXT_NOTE =
  'El texto del mensaje no se muestra aquí: está en la conversación.'

/** Slice 7: the customer's rating comment is redacted the same way (`case.rated`). */
export const REDACTED_COMMENT_NOTE =
  'El comentario del cliente no se muestra aquí: está en el caso cerrado.'

/** Slice 9: an escalation's motive and supervision's answer are staff text, redacted too. */
export const REDACTED_MOTIVE_NOTE =
  'El motivo del escalamiento no se muestra aquí: está en el caso y en Escalados.'
export const REDACTED_NOTE_NOTE =
  'La respuesta de supervisión no se muestra aquí: está en el caso y en Escalados.'

/** The note under "Datos del evento" for what the PII policy removed, or null. */
export function redactionNote(event: Pick<AuditEvent, 'redactedFields'>): string | null {
  if (hidesMessageText(event)) return REDACTED_TEXT_NOTE
  if (event.redactedFields.includes('comment')) return REDACTED_COMMENT_NOTE
  if (event.redactedFields.includes('motive')) return REDACTED_MOTIVE_NOTE
  if (event.redactedFields.includes('note')) return REDACTED_NOTE_NOTE
  return null
}

// ── Persona filter ───────────────────────────────────────────────────────────

/** "Persona" option: active and inactive staff, the inactive ones marked "(desactivada)". */
export function personOptionLabel(person: { name: string; active: boolean }): string {
  return person.active ? person.name : `${person.name} (desactivada)`
}
