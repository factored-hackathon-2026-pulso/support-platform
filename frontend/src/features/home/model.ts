/**
 * Pure rules and copy of the analyst home, "Inicio" (HomeTurno.dc.html;
 * docs/platform/api/slice-6-analyst-home.md §4). No React, no I/O: unit-tested
 * in model.test.ts.
 *
 * "Mientras no estabas" is deterministic: every row comes from one structured
 * fact the server sends (`HomeActivityItem`) and one fixed template per `kind`
 * below (catalog `home`, read when a function runs). Nothing is summarised,
 * ranked or generated.
 *
 * UI rule (slice 6 §4.7): metadata is never a dot-joined string or a sentence.
 * Each fact is its own short item (`FactItem`: icon + 1–3 words), the status a
 * glyph + word (`caseStatus`, the cases map), the time its own element with a clock.
 */
import { workspacePath } from '@/app/paths'
import { spokenFact, type FactItem, type StatusAppearance, type Tone } from '@/components/ui'
import {
  ESCALATED_MARKER,
  INBOX_FILTERS,
  caseCardFacts,
  caseStatus,
  slaFact,
  sortByUrgency,
  type AvailabilityStatus,
  type CaseSummary,
  type CloseReason,
  type InboxCounts,
  type InboxStatus,
} from '@/features/cases/core'
import type { Language } from '@/features/conversation/core'
import {
  formatDate,
  formatLongDate,
  formatRelativeTime,
  formatTime,
  localDayKey,
  localHour,
} from '@/lib/format'
import { i18n } from '@/lib/i18n'
import type {
  AnalystHome,
  HomeActivityItem,
  HomeActivityKind,
  HomeAssistant,
  HomeQueue,
  HomeTeam,
} from './types'

type DateInput = Date | string | number

const t = i18n.getFixedT(null, 'home')

// ─── Header ──────────────────────────────────────────────────────────────────

/** "Buenos días" 05:00–11:59 · "Buenas tardes" 12:00–18:59 · "Buenas noches" otherwise. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return t('header.morning')
  if (hour >= 12 && hour < 19) return t('header.afternoon')
  return t('header.evening')
}

/** "Buenas noches, Daniela" at the viewer's local time. */
export function greeting(name: string, now: DateInput): string {
  const first = name.trim().split(/\s+/)[0] ?? name
  return t('header.greeting', { greeting: greetingFor(localHour(now)), name: first })
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
      ? { key: 'new', icon: 'pause', text: t('availability.noNewCases'), tone: 'warn' }
      : { key: 'new', icon: 'check', text: t('availability.receivesNewCases'), tone: 'success' },
  ]
  if (openCases !== null) {
    facts.push({
      key: 'open',
      icon: 'inbox',
      text: t('availability.openCases', { count: openCases }),
    })
  }
  return paused
    ? {
        title: t('availability.pausedTitle'),
        facts,
        action: t('availability.start'),
        tone: 'warn',
      }
    : {
        title: t('availability.availableTitle'),
        facts,
        action: t('availability.pause'),
        tone: 'success',
      }
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
            href: workspacePath({ status: filter.status }),
          },
        ]
      : [],
  )
}

/** The small hint under the Cerrados tile (its own element, not joined to the label). */
export function closedTileHint(): string {
  return t('tiles.closedHint')
}

/** Accessible name of a tile link: "2 Por responder. Ver en Casos". */
export function statusTileLabel(tile: StatusTile, hint: string | null): string {
  const subject =
    tile.count === null
      ? t('tiles.noCount', { label: tile.label })
      : t('tiles.count', { count: tile.count, label: tile.label })
  return hint
    ? t('tiles.linkWithHint', { subject, hint: hint.toLowerCase() })
    : t('tiles.link', { subject })
}

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
  return workspacePath({ caseId, status: inboxStatus })
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
      const preview = summary.preview ?? t('first.noMessages')
      const sla = slaFact(summary, now)
      return {
        id: summary.id,
        name: summary.customer.displayName,
        status: caseStatus(summary.inboxStatus),
        escalated: summary.escalated ? ESCALATED_MARKER : null,
        facts: caseCardFacts(summary),
        preview:
          summary.previewAuthorRole === 'analyst'
            ? t('first.ownPreview', { text: preview })
            : preview,
        sla,
        last: {
          key: 'last',
          icon: 'clock',
          text: formatRelativeTime(summary.lastInteractionAt, now),
          label:
            summary.inboxStatus === 'waiting' ? t('first.waitingSince') : t('first.lastActivity'),
          tooltip:
            summary.inboxStatus === 'waiting' ? t('first.waitingTooltip') : t('first.lastActivity'),
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
  assigned_by_assistant: 'in',
}

/** Whole minutes of a wait, at least 1 ("Esperó 1 min" for 20 s). */
function waitMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60))
}

/** Rule 3 applied: the language mark, and the "Regla 3" tag only for Portuguese. */
export function languageFact(language: Language): FactItem {
  return {
    key: 'language',
    icon: 'languages',
    text: '',
    label: t('feed.fact.byLanguage'),
    languages: [language],
    ...(language === 'pt' ? { tag: t('feed.fact.rule3') } : {}),
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
  const supervisor = item.actorName ?? t('feed.fact.supervision')
  switch (item.kind) {
    case 'assigned_on_arrival':
      return { ...base, phrase: t('feed.phrase.arrived'), facts: [languageFact(item.language)] }
    case 'assigned_from_queue':
      return {
        ...base,
        phrase: t('feed.phrase.fromQueue'),
        facts: compact([
          item.waitedSeconds === null
            ? null
            : {
                key: 'waited',
                icon: 'hourglass',
                text: t('feed.fact.waited', { minutes: waitMinutes(item.waitedSeconds) }),
              },
        ]),
      }
    case 'assigned_by_supervisor':
      return {
        ...base,
        phrase: t('feed.phrase.assigned'),
        status: caseStatus(item.inboxStatus),
        facts: compact([
          {
            key: 'by',
            icon: 'users',
            text: supervisor,
            label: t('feed.fact.assignedBy'),
            tooltip: t('feed.fact.assignedBy'),
          },
          itemSla(item, now),
        ]),
      }
    case 'reassigned_away':
      return {
        ...base,
        phrase: t('feed.phrase.reassignedAway'),
        facts: [
          {
            key: 'by',
            icon: 'users',
            text: supervisor,
            label: t('feed.fact.reassignedBy'),
            tooltip: t('feed.fact.reassignedBy'),
          },
          {
            key: 'to',
            icon: 'user',
            text: item.targetName ?? t('feed.fact.otherPerson'),
            label: t('feed.fact.nowWith'),
            tooltip: t('feed.fact.nowWith'),
          },
          { key: 'read-only', icon: 'eye', text: t('feed.fact.readOnly') },
        ],
      }
    case 'customer_returned': {
      const count = item.previousCasesCount ?? 0
      return {
        ...base,
        phrase: t('feed.phrase.returned'),
        facts: compact([
          count > 0
            ? {
                key: 'previous',
                icon: 'history',
                text: t('feed.fact.previousCases', { count }),
                label: t('feed.fact.previousCasesLabel'),
              }
            : null,
        ]),
        lastCloseReason: item.lastCloseReason,
      }
    }
    case 'customer_messages':
      return {
        ...base,
        phrase: t('feed.phrase.messages', { count: item.messageCount ?? 1 }),
        status: caseStatus(item.inboxStatus),
        facts: compact([itemSla(item, now)]),
      }
    // Slice 21 (IaHomeTurno): the assistant handed the case over and it went to her.
    case 'assigned_by_assistant':
      return {
        ...base,
        phrase: t('feed.phrase.fromAssistant'),
        status: caseStatus(item.inboxStatus),
        facts: compact([itemSla(item, now)]),
      }
  }
}

/**
 * Slice 21 (IaHomeTurno): what the assistant did in her languages since her last session, as one
 * line of "Mientras no estabas" ("Resolvió 9 conversaciones de tus idiomas y te pasó 1"), or null
 * when it did nothing (or AI is off: no summary).
 */
export function assistantSummary(assistant: HomeAssistant | null | undefined): string | null {
  if (!assistant) return null
  const { resolved, handedToYou } = assistant
  const resolvedText = t('feed.assistant.resolved', { count: resolved })
  if (resolved > 0 && handedToYou > 0) {
    return t('feed.assistant.resolvedAndHanded', { resolved: resolvedText, handed: handedToYou })
  }
  if (resolved > 0) return resolvedText
  if (handedToYou > 0) return t('feed.assistant.handed', { count: handedToYou })
  return null
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
  const facts = row.facts.map(spokenFact)
  const parts = [
    row.status?.label,
    ...facts,
    reasonLabel ? t('feed.link.lastClose', { reason: reasonLabel }) : null,
    row.when,
  ].filter(Boolean)
  return t('feed.link.label', {
    name: row.customerName,
    phrase: row.phrase,
    details: parts.join(', '),
    target: row.readOnly ? t('feed.link.openReadOnly') : t('feed.link.open'),
  })
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
        text: t('feed.since.fallback'),
        tooltip: t('feed.since.fallbackTooltip'),
      },
    ]
  }
  const time = formatTime(home.since)
  const day = localDayKey(home.since)
  const nowDate = now instanceof Date ? now : new Date(now)
  const yesterday = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000)
  let when: string
  if (day === localDayKey(nowDate)) when = t('feed.since.today', { time })
  else if (day === localDayKey(yesterday)) when = t('feed.since.yesterday', { time })
  else when = t('feed.since.dateTime', { date: formatDate(home.since, { withYear: false }), time })
  return [
    { key: 'logout', icon: 'log-out', text: t('feed.since.signedOut') },
    { key: 'since', icon: 'clock', text: when, label: t('feed.since.label') },
  ]
}

/** "Ver todo (n)" while collapsed; "Ver menos" when expanded; null when everything fits. */
export function feedToggleLabel(shown: number, total: number, expanded: boolean): string | null {
  if (expanded) return t('feed.showLess')
  return total > shown ? t('feed.showAll', { total }) : null
}

/** The server sends at most 10 rows; say so when there were more. */
export function feedTruncatedNote(returned: number, total: number): string | null {
  return total > returned ? t('feed.truncated', { shown: returned, total }) : null
}

export function emptyFeedCopy(): string {
  return t('feed.empty')
}

// ─── "Tu equipo ahora" ───────────────────────────────────────────────────────

export interface TeamRow {
  key: string
  icon: FactItem['icon']
  /** A queue row: its language mark stands in for the icon. */
  language?: Language
  label: string
  value: string
  /** "Tú": she is one of the available ones. */
  tag: string | null
  /** The oldest wait of a queue ([clock] hace 17 min). */
  wait: FactItem | null
}

/** Available analysts of her team: "1 de 4", counts only, no names. */
export function availableValue(team: HomeTeam): string {
  return t('team.availableValue', { available: team.availableCount, total: team.analystCount })
}

/** The oldest wait of a queue, or null when nobody waits. */
export function queueWait(queue: HomeQueue, now: DateInput): FactItem | null {
  if (queue.waiting === 0 || !queue.oldestQueuedAt) return null
  return {
    key: 'wait',
    icon: 'clock',
    text: formatRelativeTime(queue.oldestQueuedAt, now),
    label: t('team.oldest'),
    tooltip: t('team.oldest'),
    tone: 'muted',
  }
}

/**
 * The rows of "Tu equipo ahora": her team's available count, then one queue per language she
 * speaks; slice 21, with AI on, how many conversations of her languages the assistant holds now.
 */
export function teamRows(
  team: HomeTeam,
  meAvailable: boolean,
  now: DateInput,
  withAssistant: number | null = null,
): TeamRow[] {
  return [
    {
      key: 'available',
      icon: 'users',
      label: t('team.available'),
      value: availableValue(team),
      tag: meAvailable ? t('team.you') : null,
      wait: null,
    },
    ...team.queues.map((queue) => ({
      key: `queue-${queue.language}`,
      icon: 'inbox' as const,
      language: queue.language,
      label: t('team.waiting'),
      value: String(queue.waiting),
      tag: null,
      wait: queueWait(queue, now),
    })),
    ...(withAssistant === null
      ? []
      : [
          {
            key: 'assistant',
            icon: 'bot' as const,
            label: t('team.withAssistant'),
            value: String(withAssistant),
            tag: null,
            wait: null,
          },
        ]),
  ]
}

/** The note under the team rows while she is paused. */
export function teamPausedNote(): string {
  return t('team.pausedNote')
}
