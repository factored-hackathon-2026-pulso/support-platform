/**
 * Pure rules and copy of the analyst home, "Inicio" (HomeTurno.dc.html;
 * docs/platform/api/slice-6-analyst-home.md §4). No React, no I/O: unit-tested
 * in model.test.ts.
 *
 * "Mientras no estabas" is deterministic: every row comes from one structured
 * fact the server sends (`HomeActivityItem`) and one fixed Spanish template per
 * `kind` below. Nothing is summarised, ranked or generated.
 *
 * UI rule (slice 6 §4.7): metadata is never a dot-joined string or a sentence.
 * Each fact is its own short item (`FactItem`: icon + 1–3 words), the status a
 * glyph + word (`caseStatus`, the cases map), the time its own element with a clock.
 */
import { workspacePath } from '@/app/roles'
import type { FactItem, StatusAppearance, Tone } from '@/components/ui'
import {
  ESCALATED_MARKER,
  INBOX_FILTERS,
  caseCardFacts,
  caseStatus,
  slaFact,
  slugFromInboxStatus,
  sortByUrgency,
  type AvailabilityStatus,
  type CaseSummary,
  type CloseReason,
  type InboxCounts,
  type InboxStatus,
} from '@/features/cases/core'
import { LANGUAGE_NAMES, type Language } from '@/features/conversation/core'
import {
  formatDate,
  formatLongDate,
  formatRelativeTime,
  formatTime,
  localDayKey,
  localHour,
  pluralize,
} from '@/lib/format'
import type { AnalystHome, HomeActivityItem, HomeActivityKind, HomeQueue, HomeTeam } from './types'

type DateInput = Date | string | number

// ─── Header ──────────────────────────────────────────────────────────────────

/** "Buenos días" 05:00–11:59 · "Buenas tardes" 12:00–18:59 · "Buenas noches" otherwise. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Buenos días'
  if (hour >= 12 && hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

/** "Buenas noches, Daniela" at the viewer's local time. */
export function greeting(name: string, now: DateInput): string {
  const first = name.trim().split(/\s+/)[0] ?? name
  return `${greetingFor(localHour(now))}, ${first}`
}

/** Above the greeting: the date as text and her team as a pill (never joined). */
export function headerLine(
  now: DateInput,
  teamName: string | null,
): {
  date: string
  team: string | null
} {
  return { date: formatLongDate(now), team: teamName || null }
}

// ─── Availability block ──────────────────────────────────────────────────────

export interface AvailabilityBlockCopy {
  /** The state, always as visible text. */
  title: string
  facts: FactItem[]
  action: string
  tone: 'warn' | 'success'
}

/** The availability block (canvas `av`): paused → "Empezar a atender"; available → "Pausar casos nuevos". */
export function availabilityBlockCopy(
  status: AvailabilityStatus,
  { openCases }: { openCases: number | null },
): AvailabilityBlockCopy {
  const paused = status === 'paused'
  const facts: FactItem[] = [
    paused
      ? { key: 'new', icon: 'pause', text: 'Sin casos nuevos', tone: 'warn' }
      : { key: 'new', icon: 'check', text: 'Recibes casos nuevos', tone: 'success' },
  ]
  if (openCases !== null) {
    facts.push({
      key: 'open',
      icon: 'inbox',
      text: pluralize(openCases, 'caso abierto', 'casos abiertos'),
    })
  }
  return paused
    ? { title: 'Estás en pausa', facts, action: 'Empezar a atender', tone: 'warn' }
    : { title: 'Estás disponible', facts, action: 'Pausar casos nuevos', tone: 'success' }
}

// ─── Status tiles (links to Casos with the filter) ───────────────────────────

export interface StatusTile {
  status: InboxStatus
  label: string
  tone: Tone
  /** The status glyph beside the label (the same as on the cards). */
  shape: StatusAppearance['shape']
  count: number | null
  href: string
}

const COUNT_OF: Record<InboxStatus, keyof Omit<InboxCounts, 'all' | 'computedAt'>> = {
  to_reply: 'toReply',
  new: 'new',
  waiting: 'waiting',
  closed: 'closed',
}

/** Canvas order: Por responder · Nuevos · Esperando al cliente · Cerrados (últimos 7 días). */
export function statusTiles(counts: InboxCounts | undefined): StatusTile[] {
  return INBOX_FILTERS.flatMap((filter) =>
    filter.status
      ? [
          {
            status: filter.status,
            label: filter.label,
            tone: filter.tone,
            shape: caseStatus(filter.status).shape,
            count: counts ? counts[COUNT_OF[filter.status]] : null,
            href: workspacePath({ filterSlug: slugFromInboxStatus(filter.status) }),
          },
        ]
      : [],
  )
}

/** The small hint under the Cerrados tile (its own element, not joined to the label). */
export const CLOSED_TILE_HINT = 'Últimos 7 días'

// ─── "Lo primero" ────────────────────────────────────────────────────────────

/** "Lo primero" shows at most this many cases (the rest are in Casos). */
export const FIRST_CASES_LIMIT = 6

export interface FirstCaseRow {
  id: string
  name: string
  status: StatusAppearance
  /** "Escalado" (glyph + word, the Casos card marker) while an escalation is open; else null. */
  escalated: StatusAppearance | null
  /** Channel, priority when high or critical, "Volvió a escribir": icon-only (the card facts). */
  facts: FactItem[]
  preview: string
  /** The first-response SLA while pending (the shared level → icon/tone map). */
  sla: FactItem | null
  /** The time since the last interaction ("hace 41 min"), shown when there is no SLA. */
  last: FactItem
  href: string
}

/** Workspace link of a case: open, with its status filter (its card is then on screen). */
export function caseHref(caseId: string, inboxStatus: InboxStatus | null): string {
  return workspacePath({ caseId, filterSlug: slugFromInboxStatus(inboxStatus) })
}

/**
 * The open cases in urgency order (`sortByUrgency`, shared with the Casos list).
 * No language here: it shows only in the customer file (slice 6 §5).
 */
export function firstCases(
  items: readonly CaseSummary[],
  now: DateInput,
  limit = FIRST_CASES_LIMIT,
): FirstCaseRow[] {
  const open = items.filter((item) => item.status !== 'closed' && item.inboxStatus !== null)
  return sortByUrgency(open, now)
    .slice(0, limit)
    .map((summary) => {
      const preview = summary.preview ?? 'Sin mensajes todavía'
      const sla = slaFact(summary, now)
      return {
        id: summary.id,
        name: summary.customer.displayName,
        status: caseStatus(summary.inboxStatus),
        escalated: summary.escalated ? ESCALATED_MARKER : null,
        facts: caseCardFacts(summary),
        preview: summary.previewAuthorRole === 'analyst' ? `Tú: ${preview}` : preview,
        sla,
        last: {
          key: 'last',
          icon: 'clock',
          text: formatRelativeTime(summary.lastInteractionAt, now),
          label: summary.inboxStatus === 'waiting' ? 'Sin respuesta desde' : 'Última actividad',
          tooltip:
            summary.inboxStatus === 'waiting' ? 'Sin respuesta del cliente' : 'Última actividad',
          tone: 'muted',
        },
        href: caseHref(summary.id, summary.inboxStatus),
      }
    })
}

// ─── "Mientras no estabas" ───────────────────────────────────────────────────

/** Rows shown before "Ver todo (n)". */
export const FEED_PREVIEW_ROWS = 4

/** Icon family of a row (canvas `in` / `back` / `out` / `msg`). */
export type ActivityIcon = 'in' | 'back' | 'out' | 'msg'

export interface ActivityRow {
  key: string
  icon: ActivityIcon
  customerName: string
  /** The fixed phrase of its kind: "Te llegó", "Escribió 2 mensajes". */
  phrase: string
  /** The case status now, glyph + word (rows where it matters). */
  status: StatusAppearance | null
  /** One short fact each (icon + 1–3 words). */
  facts: FactItem[]
  /** "Volvió a escribir": how the case it continues was closed (icon + label in the UI). */
  lastCloseReason: CloseReason | null
  /** "hace 2 min" (with a clock in the UI). */
  when: string
  href: string
  readOnly: boolean
}

const ICON_OF: Record<HomeActivityKind, ActivityIcon> = {
  assigned_on_arrival: 'in',
  assigned_from_queue: 'in',
  assigned_by_supervisor: 'in',
  reassigned_away: 'out',
  customer_returned: 'back',
  customer_messages: 'msg',
}

/** Whole minutes of a wait, at least 1 ("Esperó 1 min" for 20 s). */
function waitMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60))
}

/** Rule 3 applied: the language as text, and the "Regla 3" tag only for Portuguese. */
export function languageFact(language: Language): FactItem {
  const name = LANGUAGE_NAMES[language]
  return {
    key: 'language',
    icon: 'languages',
    text: name.charAt(0).toUpperCase() + name.slice(1),
    label: 'Por idioma',
    ...(language === 'pt' ? { tag: 'Regla 3' } : {}),
  }
}

/** The first-response SLA of a row's case now, or null once answered or closed. */
function itemSla(item: HomeActivityItem, now: DateInput): FactItem | null {
  return slaFact(
    { status: item.caseStatus, slaDueAt: item.slaDueAt, firstResponseAt: item.firstResponseAt },
    now,
  )
}

const compact = (facts: (FactItem | null)[]): FactItem[] =>
  facts.filter((fact): fact is FactItem => fact !== null)

/** The fixed template of each kind (contract §4.5, "Plantillas"): phrase, status and facts. */
export function activityTemplate(
  item: HomeActivityItem,
  now: DateInput,
): Pick<ActivityRow, 'phrase' | 'status' | 'facts' | 'lastCloseReason'> {
  const base = { status: null, facts: [], lastCloseReason: null }
  const supervisor = item.actorName ?? 'Supervisión'
  switch (item.kind) {
    case 'assigned_on_arrival':
      return { ...base, phrase: 'Te llegó', facts: [languageFact(item.language)] }
    case 'assigned_from_queue':
      return {
        ...base,
        phrase: 'Te llegó desde la cola',
        facts: compact([
          item.waitedSeconds === null
            ? null
            : {
                key: 'waited',
                icon: 'hourglass',
                text: `Esperó ${waitMinutes(item.waitedSeconds)} min`,
              },
        ]),
      }
    case 'assigned_by_supervisor':
      return {
        ...base,
        phrase: 'Te lo asignaron',
        status: caseStatus(item.inboxStatus),
        facts: compact([
          {
            key: 'by',
            icon: 'users',
            text: supervisor,
            label: 'Asignado por',
            tooltip: 'Asignado por',
          },
          itemSla(item, now),
        ]),
      }
    case 'reassigned_away':
      return {
        ...base,
        phrase: 'Ya no es tuyo',
        facts: [
          {
            key: 'by',
            icon: 'users',
            text: supervisor,
            label: 'Lo reasignó',
            tooltip: 'Lo reasignó',
          },
          {
            key: 'to',
            icon: 'user',
            text: item.targetName ?? 'Otra persona',
            label: 'Ahora lo atiende',
            tooltip: 'Ahora lo atiende',
          },
          { key: 'read-only', icon: 'eye', text: 'Solo lectura' },
        ],
      }
    case 'customer_returned': {
      const count = item.previousCasesCount ?? 0
      return {
        ...base,
        phrase: 'Volvió a escribir',
        facts: compact([
          count > 0
            ? {
                key: 'previous',
                icon: 'history',
                text: pluralize(count, 'caso antes', 'casos antes'),
                label: 'Casos anteriores',
              }
            : null,
        ]),
        lastCloseReason: item.lastCloseReason,
      }
    }
    case 'customer_messages':
      return {
        ...base,
        phrase: `Escribió ${pluralize(item.messageCount ?? 1, 'mensaje')}`,
        status: caseStatus(item.inboxStatus),
        facts: compact([itemSla(item, now)]),
      }
  }
}

/**
 * One row: icon, customer, phrase, status and facts, time and the link. A case that
 * is no longer hers (`readOnly`) opens without a filter: the Workspace shows it
 * read-only ("Solo lectura: este caso es de …") through history access.
 */
export function activityRow(item: HomeActivityItem, now: DateInput): ActivityRow {
  return {
    key: `${item.kind}:${item.caseId}`,
    icon: ICON_OF[item.kind],
    customerName: item.customerName,
    ...activityTemplate(item, now),
    when: formatRelativeTime(item.occurredAt, now),
    href: item.readOnly
      ? workspacePath({ caseId: item.caseId })
      : caseHref(item.caseId, item.inboxStatus),
    readOnly: item.readOnly,
  }
}

/** Accessible name of a row link: who, what, the facts and the time, then where it goes. */
export function activityLinkLabel(row: ActivityRow, reasonLabel?: string): string {
  const facts = row.facts.map((fact) => (fact.label ? `${fact.label}: ${fact.text}` : fact.text))
  const parts = [
    row.status?.label,
    ...facts,
    reasonLabel ? `Último cierre: ${reasonLabel}` : null,
    row.when,
  ].filter(Boolean)
  const target = row.readOnly ? 'Abrir en solo lectura' : 'Abrir el caso'
  return `${row.customerName}: ${row.phrase}. ${parts.join(', ')}. ${target}`
}

/** Under "Mientras no estabas": [log-out] Cerraste sesión, [clock] hoy 11:20; or the fallback. */
export function sinceFacts(
  home: Pick<AnalystHome, 'since' | 'sinceSource'>,
  now: DateInput,
): FactItem[] {
  if (home.sinceSource === 'fallback') {
    return [
      {
        key: 'since',
        icon: 'clock',
        text: 'Últimas 8 horas',
        tooltip: 'No hay una sesión tuya anterior',
      },
    ]
  }
  const time = formatTime(home.since)
  const day = localDayKey(home.since)
  const nowDate = now instanceof Date ? now : new Date(now)
  const yesterday = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000)
  let when: string
  if (day === localDayKey(nowDate)) when = `hoy ${time}`
  else if (day === localDayKey(yesterday)) when = `ayer ${time}`
  else when = `${formatDate(home.since, { withYear: false })}, ${time}`
  return [
    { key: 'logout', icon: 'log-out', text: 'Cerraste sesión' },
    { key: 'since', icon: 'clock', text: when, label: 'Desde' },
  ]
}

/** "Ver todo (n)" while collapsed; "Ver menos" when expanded; null when everything fits. */
export function feedToggleLabel(shown: number, total: number, expanded: boolean): string | null {
  if (expanded) return 'Ver menos'
  return total > shown ? `Ver todo (${total})` : null
}

/** The server sends at most 10 rows; say so when there were more. */
export function feedTruncatedNote(returned: number, total: number): string | null {
  return total > returned ? `Se muestran las ${returned} más recientes de ${total}.` : null
}

export const EMPTY_FEED_COPY = 'Nada nuevo desde tu última sesión'

// ─── "Tu equipo ahora" ───────────────────────────────────────────────────────

export interface TeamRow {
  key: string
  icon: FactItem['icon']
  label: string
  value: string
  /** "Tú": she is one of the available ones. */
  tag: string | null
  /** The oldest wait of a queue ([clock] hace 17 min). */
  wait: FactItem | null
}

/** Available analysts of her team: "1 de 4", counts only, no names. */
export function availableValue(team: HomeTeam): string {
  return `${team.availableCount} de ${team.analystCount}`
}

/** The oldest wait of a queue, or null when nobody waits. */
export function queueWait(queue: HomeQueue, now: DateInput): FactItem | null {
  if (queue.waiting === 0 || !queue.oldestQueuedAt) return null
  return {
    key: 'wait',
    icon: 'clock',
    text: formatRelativeTime(queue.oldestQueuedAt, now),
    label: 'El más antiguo',
    tooltip: 'El más antiguo',
    tone: 'muted',
  }
}

/** The rows of "Tu equipo ahora": her team's available count, then one queue per language she speaks. */
export function teamRows(team: HomeTeam, meAvailable: boolean, now: DateInput): TeamRow[] {
  return [
    {
      key: 'available',
      icon: 'users',
      label: 'Disponibles',
      value: availableValue(team),
      tag: meAvailable ? 'Tú' : null,
      wait: null,
    },
    ...team.queues.map((queue) => ({
      key: `queue-${queue.language}`,
      icon: 'inbox' as const,
      label: `Cola en ${LANGUAGE_NAMES[queue.language]}`,
      value: String(queue.waiting),
      tag: null,
      wait: queueWait(queue, now),
    })),
  ]
}

/** The note under the team rows while she is paused. */
export const TEAM_PAUSED_NOTE = 'Al empezar, la cola de tus idiomas se reparte primero contigo.'
