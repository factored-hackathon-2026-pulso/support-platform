/**
 * Pure rules and copy of supervision (canvas SuColas, SuTeam, SuEscalados, SuCaso;
 * contracts docs/platform/api/slice-3-supervision.md and slice-9-supervision-v2.md):
 * the "Ahora" states, "Colas" (every open case of a language, its filters and cells),
 * "Equipo" (the analysts, their filters and figures), the reassign dialog (suggestions,
 * search, rule 3, the pause confirmation, what the customer sees, failures),
 * "Escalados" (groups, outcomes, failures) and the notices (the URL state is in url.ts).
 * Time-dependent figures take `now`. No React, no I/O: unit-tested in model.test.ts.
 * Copy comes from the `supervision` catalog, read when a function runs (slice 23), so it is
 * in the UI language of that moment; the constants of copy are getters for the same reason.
 *
 * Assignment is automatic (rule 3, the least loaded first): supervision never assigns
 * a queued case by hand any more; "Reasignar" stays as the exception.
 */
import { PATHS } from '@/app/paths'
import {
  LANGUAGE_NATIVE_NAME,
  type FactIcon,
  type FactItem,
  type FactTone,
  type FilterGroup,
  type FilterSelection,
  type StatusAppearance,
} from '@/components/ui'
import {
  CASE_PRIORITY,
  CASE_STATUS,
  WITH_ASSISTANT_STATUS,
  PRIORITY_OPTIONS,
  caseChannel,
  channelFact,
  channelLabel,
  countryName,
  formatSla,
  priorityFact,
  ratingOption,
  slaFact,
  type CasePriority,
} from '@/features/cases'
import {
  LANGUAGE_NAMES,
  QUEUE_LABEL,
  formatWait,
  shortCaseId,
  type CaseCustomer,
} from '@/features/conversation'
import { isApiProblem } from '@/lib/api'
import { formatRelativeTime, localDayKey } from '@/lib/format'
import { i18n } from '@/lib/i18n'
import type {
  AnalystActivity,
  CaseSummary,
  Escalation,
  EscalationItem,
  Language,
  OpenCaseRow,
  RatingStats,
  TeamAnalyst,
  TeamOverview,
  TeamSummary,
} from './types'
import type { QueuesUrlState, TeamUrlState } from './url'

export { QUEUE_LABEL }

const t = i18n.getFixedT(null, 'supervision')

/** "Listo" (the result strips' prefix). */
function done(): string {
  return i18n.t('common:actions.done')
}

/** "Revisa tu conexión e inténtalo de nuevo." */
function connectionHint(): string {
  return i18n.t('common:query.errorDescription')
}

/** The role's name, where nobody signs what supervision did ("Supervisión"). */
export function supervisionName(): string {
  return i18n.t('shell:roles.supervisor.name')
}

/** "Carga alta" from this many open cases (team-generated, slice 3 §1.2). */
export const HIGH_LOAD_OPEN_CASES = 5

/** Queues are global, one per language, always in this order. */
export const QUEUE_LANGUAGES: readonly Language[] = ['es', 'pt']

type DateInput = Date | string | number

const toMs = (value: DateInput) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime()

/** "Daniela" from "Daniela Ríos". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** Accent- and case-insensitive text for search ("julian" finds "Julián"). */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
}

// ── "Ahora" (slice 3 §2.2) ───────────────────────────────────────────────────

/** What an analyst is doing now, as glyph + word (Status). */
export type ActivityMeta = StatusAppearance

/**
 * The one availability map (the dot language, Linear-style): filled dot = attending
 * cases, ring = free to take one, pause glyph = paused, grey ring = not connected.
 * Per-person labels are gender-neutral ("Sin conexión").
 */
function activityMeta(
  activity: AnalystActivity,
  appearance: Omit<ActivityMeta, 'label'>,
): ActivityMeta {
  return {
    ...appearance,
    get label() {
      return t(`activity.${activity}`)
    },
  }
}

export const ACTIVITY_META: Readonly<Record<AnalystActivity, ActivityMeta>> = {
  busy: activityMeta('busy', { shape: 'dot', tone: 'success' }),
  available: activityMeta('available', { shape: 'ring', tone: 'success' }),
  paused: activityMeta('paused', { shape: 'pause', tone: 'warn' }),
  offline: activityMeta('offline', { shape: 'ring', tone: 'neutral' }),
}

/** Order of the activities ("Equipo" rows, the filter options). */
export const ACTIVITY_ORDER: readonly AnalystActivity[] = ['busy', 'available', 'paused', 'offline']

/** Presence dot on an avatar (the reassign dialog): green connected, orange paused, grey off. */
export type PresenceTone = 'success' | 'warn' | 'offline'

export function presenceTone(activity: AnalystActivity): PresenceTone {
  if (activity === 'paused') return 'warn'
  if (activity === 'offline') return 'offline'
  return 'success'
}

/** Hint of an available analyst without a session: cases keep landing on her. */
export const NO_SESSION_HINT: { readonly label: string; readonly title: string } = {
  get label() {
    return t('noSessionHint.label')
  },
  get title() {
    return t('noSessionHint.title')
  },
}

export function showsNoSessionHint(analyst: Pick<TeamAnalyst, 'activity' | 'signedIn'>): boolean {
  return (analyst.activity === 'busy' || analyst.activity === 'available') && !analyst.signedIn
}

export function speaksLanguage(
  analyst: Pick<TeamAnalyst, 'languages'>,
  language: Language,
): boolean {
  return analyst.languages.includes(language)
}

// ── Time-dependent figures (recomputed with the ticking clock) ───────────────

/**
 * Time since `since`: seconds under a minute, whole minutes above ("4 min",
 * "1 h 05 min"), so a clock that ticks every few seconds does not make the figure jitter.
 */
export function waitSince(since: DateInput, now: DateInput): string {
  const seconds = Math.max(0, (toMs(now) - toMs(since)) / 1000)
  return formatWait(seconds < 60 ? seconds : Math.floor(seconds / 60) * 60)
}

/** Cases whose first-response SLA is at risk (≤ 5 min left, or overdue). */
export function atRiskCount(cases: readonly CaseSummary[], now: DateInput): number {
  return cases.filter((summary) => formatSla(summary, now)?.atRisk).length
}

/** "Espera más larga": since the oldest customer still waiting for her, or "—". */
export function longestWait(
  analyst: Pick<TeamAnalyst, 'oldestWaitingSince'>,
  now: DateInput,
): string {
  return analyst.oldestWaitingSince ? waitSince(analyst.oldestWaitingSince, now) : '—'
}

export function isHighLoad(analyst: Pick<TeamAnalyst, 'counts'>): boolean {
  return analyst.counts.open >= HIGH_LOAD_OPEN_CASES
}

/** "Abiertos": the number, or "—" for someone offline with nothing open. */
export function openCasesCell(analyst: Pick<TeamAnalyst, 'counts' | 'activity'>): string {
  return analyst.activity === 'offline' && analyst.counts.open === 0
    ? '—'
    : String(analyst.counts.open)
}

/** "Por responder" column: the customer wrote last (Nuevos + Por responder). */
export function toReplyCount(analyst: Pick<TeamAnalyst, 'counts'>): number {
  return analyst.counts.new + analyst.counts.toReply
}

// ── Case cells shared by Colas, the analyst sheet and Escalados ──────────────

/**
 * The priority in a supervision row (slice 8): every level, icon-only (the glyph, the
 * tooltip and accessible text "Prioridad alta" / "Sin prioridad").
 */
export function casePriorityFact(summary: Pick<CaseSummary, 'priority'>): Omit<FactItem, 'key'> {
  const { key: _key, ...fact } = priorityFact(summary.priority, { onlyUrgent: false }) as FactItem
  return fact
}

/** The facts after the status of an analyst's case row: the channel (icon-only). */
export function caseRowFacts(summary: Pick<CaseSummary, 'channel'>): FactItem[] {
  return [channelFact(summary.channel)]
}

/**
 * "Primera respuesta" (Colas): overdue → filled red flame "Vencida"; ≤ 5 min → orange
 * flame "4 min"; running → clock "14 min"; answered → check "Respondida" (muted).
 */
export function firstResponseFact(
  summary: Pick<CaseSummary, 'status' | 'slaDueAt' | 'firstResponseAt'>,
  now: DateInput,
): FactItem {
  // Slice 19: the first-response SLA is a person's; it starts when the case leaves the assistant.
  if (summary.status === 'with_assistant') {
    return {
      key: 'first-response',
      icon: 'pause',
      tone: 'muted',
      text: t('firstResponse.notRunning'),
      label: t('firstResponse.label'),
      tooltip: t('firstResponse.notRunningTooltip'),
    }
  }
  const sla = slaFact(summary, now)
  if (!sla) {
    return {
      key: 'first-response',
      icon: 'check',
      tone: 'muted',
      text: t('firstResponse.answered'),
      label: t('firstResponse.label'),
      tooltip: t('firstResponse.answeredTooltip'),
    }
  }
  if (sla.level === 'overdue') {
    return {
      key: 'first-response',
      icon: 'flame-filled',
      tone: 'danger',
      text: t('firstResponse.overdue'),
      label: t('firstResponse.label'),
      tooltip: t('firstResponse.overdueTooltip'),
    }
  }
  return {
    key: 'first-response',
    icon: sla.icon,
    tone: sla.level === 'at_risk' ? 'warn' : 'default',
    text: sla.text,
    label: t('firstResponse.dueLabel'),
    tooltip: t('firstResponse.dueTooltip', { time: sla.text }),
  }
}

/** The assistant's name where Supervisión sees who holds a case ("Lo tiene"). */
export function assistantHolder(): string {
  return t('assistantHolder')
}

export function isWithAssistant(summary: Pick<CaseSummary, 'status'>): boolean {
  return summary.status === 'with_assistant'
}

/**
 * Status of an open case for supervision: "Sin asignar" while nobody holds it, "Con el
 * asistente" while the assistant does (slice 19; such a case has no `inboxStatus`).
 */
export function openCaseStatus(
  summary: Pick<CaseSummary, 'inboxStatus'> & Partial<Pick<CaseSummary, 'status'>>,
): StatusAppearance {
  if (summary.status === 'with_assistant') return WITH_ASSISTANT_STATUS
  const config = CASE_STATUS[summary.inboxStatus ?? 'queued']
  return config.strong
    ? { shape: config.shape, tone: config.tone, label: config.label, strong: true }
    : { shape: config.shape, tone: config.tone, label: config.label }
}

/** "11 min" since it opened ("Abierto" column; "Abierto hace" fact). */
export function openForText(summary: Pick<CaseSummary, 'openedAt'>, now: DateInput): string {
  return waitSince(summary.openedAt, now)
}

// ── "Colas" (slice 9) ────────────────────────────────────────────────────────

/**
 * A queue in the left list: "11 abiertos", "2 sin asignar", "3 en riesgo"; slice 19: "2 con el
 * asistente" (its cases are not counted as open for people, as `GET /supervision/queues` does).
 */
export interface QueueNavFigures {
  open: number
  unassigned: number
  atRisk: number
  withAssistant: number
}

/** The figures of one language from its rows (the selected queue, with the live clock). */
export function queueFiguresFromRows(
  rows: readonly OpenCaseRow[],
  now: DateInput,
): QueueNavFigures {
  const people = rows.filter((row) => !isWithAssistant(row.case))
  return {
    open: people.length,
    unassigned: people.filter((row) => row.case.status === 'queued').length,
    atRisk: atRiskCount(
      people.map((row) => row.case),
      now,
    ),
    withAssistant: rows.length - people.length,
  }
}

export function queueNavLabels(figures: QueueNavFigures): {
  open: string
  unassigned: string
  atRisk: string
  withAssistant: string
} {
  return {
    open: t('queues.open', { count: figures.open }),
    unassigned: t('queues.unassigned', { count: figures.unassigned }),
    atRisk: t('queues.atRisk', { count: figures.atRisk }),
    withAssistant: t('queues.withAssistant', { count: figures.withAssistant }),
  }
}

/** Header copy of "Colas": assignment is automatic (rule 3). */
export function automaticAssignmentNote(): string {
  return t('queues.automaticNote')
}

/** "11 casos abiertos" / "3 de 11 casos abiertos" under the queue title. */
export function shownCasesLabel(shown: number, total: number, filtered: boolean): string {
  return filtered
    ? t('queues.shownFiltered', { shown, count: total })
    : t('queues.shown', { count: total })
}

/** Name of the queue's table: "Casos abiertos en portugués". */
export function openCasesTableLabel(language: Language): string {
  return t('queues.tableLabel', { language: LANGUAGE_NAMES[language] })
}

export function emptyQueueTitle(language: Language): string {
  return t('queues.emptyTitle', { language: LANGUAGE_NAMES[language] })
}

/**
 * Status options of "Colas" (the statuses an open case can have, `queued` = Sin asignar;
 * slice 19: `with_assistant` = Con el asistente, offered only while AI is on).
 */
export type OpenCaseStatusKey = 'queued' | 'new' | 'to_reply' | 'waiting' | 'with_assistant'

export const OPEN_CASE_STATUS_KEYS: readonly OpenCaseStatusKey[] = [
  'queued',
  'new',
  'to_reply',
  'waiting',
  'with_assistant',
]

function statusKeyOf(summary: Pick<CaseSummary, 'inboxStatus' | 'status'>): OpenCaseStatusKey {
  if (summary.status === 'with_assistant') return 'with_assistant'
  const status = summary.inboxStatus
  return status === 'new' || status === 'to_reply' || status === 'waiting' ? status : 'queued'
}

function statusOptionLabel(key: OpenCaseStatusKey): string {
  return key === 'with_assistant' ? WITH_ASSISTANT_STATUS.label : CASE_STATUS[key].label
}

/** The checked filters of "Colas" as a `FilterSelection` (the FilterMenu's input). */
export function queuesSelection(state: QueuesUrlState): FilterSelection {
  return {
    status: state.statuses,
    priority: state.priorities,
    analyst: state.analysts,
  }
}

/** A `FilterSelection` back into the URL state (unknown values dropped). */
export function queuesStateFromSelection(
  state: QueuesUrlState,
  selection: FilterSelection,
): QueuesUrlState {
  return {
    ...state,
    statuses: (selection.status ?? []).filter((v): v is OpenCaseStatusKey =>
      (OPEN_CASE_STATUS_KEYS as readonly string[]).includes(v),
    ),
    priorities: (selection.priority ?? []).filter((v): v is CasePriority => v in CASE_PRIORITY),
    analysts: [...(selection.analyst ?? [])],
  }
}

type RowTest = (row: OpenCaseRow, value: string) => boolean

const QUEUE_TESTS: Record<'status' | 'priority' | 'analyst', RowTest> = {
  status: (row, value) => statusKeyOf(row.case) === value,
  priority: (row, value) => row.case.priority === value,
  analyst: (row, value) => row.case.assignedAnalystId === value,
}

function passesGroup(row: OpenCaseRow, key: keyof typeof QUEUE_TESTS, values: readonly string[]) {
  return values.length === 0 || values.some((value) => QUEUE_TESTS[key](row, value))
}

/** Rows that pass every group (OR inside a group, AND across groups); `except` skips one. */
function filterRows(
  rows: readonly OpenCaseRow[],
  selection: FilterSelection,
  except?: keyof typeof QUEUE_TESTS,
): OpenCaseRow[] {
  const keys = Object.keys(QUEUE_TESTS) as (keyof typeof QUEUE_TESTS)[]
  return rows.filter((row) =>
    keys.every((key) => key === except || passesGroup(row, key, selection[key] ?? [])),
  )
}

export function filterOpenCases(
  rows: readonly OpenCaseRow[],
  state: QueuesUrlState,
): OpenCaseRow[] {
  return filterRows(rows, queuesSelection(state))
}

/**
 * The "Filtros" groups of "Colas": Estado, Prioridad and Analista (who holds cases of
 * this language), each option with a faceted count (rows that pass the other groups).
 */
export function queueFilterGroups(
  rows: readonly OpenCaseRow[],
  state: QueuesUrlState,
  { aiEnabled = false }: { aiEnabled?: boolean } = {},
): FilterGroup[] {
  const selection = queuesSelection(state)
  const count = (key: keyof typeof QUEUE_TESTS, value: string) =>
    filterRows(rows, selection, key).filter((row) => QUEUE_TESTS[key](row, value)).length
  const holders = new Map<string, string>()
  for (const row of rows) {
    const id = row.case.assignedAnalystId
    if (id) holders.set(id, row.assigneeName ?? id)
  }
  for (const id of state.analysts) if (!holders.has(id)) holders.set(id, id)
  return [
    {
      key: 'status',
      legend: t('filters.status'),
      options: OPEN_CASE_STATUS_KEYS.filter(
        (key) => key !== 'with_assistant' || aiEnabled || state.statuses.includes('with_assistant'),
      ).map((key) => ({
        value: key,
        label: statusOptionLabel(key),
        count: count('status', key),
      })),
    },
    {
      key: 'priority',
      legend: t('filters.priority'),
      options: PRIORITY_OPTIONS.map((config) => ({
        value: config.value,
        label: config.label,
        count: count('priority', config.value),
      })),
    },
    {
      key: 'analyst',
      legend: t('filters.analyst'),
      options: [...holders.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], 'es', { sensitivity: 'base' }))
        .map(([id, name]) => ({ value: id, label: name, count: count('analyst', id) })),
    },
  ]
}

// ── "Equipo" (slice 9: one table, no team tabs) ──────────────────────────────

type AnalystTest = (analyst: TeamAnalyst, value: string) => boolean

const TEAM_TESTS: Record<'status' | 'language' | 'team', AnalystTest> = {
  status: (analyst, value) => analyst.activity === value,
  language: (analyst, value) => analyst.languages.includes(value as Language),
  team: (analyst, value) => analyst.team.id === value,
}

export function teamSelection(state: TeamUrlState): FilterSelection {
  return { status: state.activities, language: state.languages, team: state.teams }
}

export function teamStateFromSelection(
  state: TeamUrlState,
  selection: FilterSelection,
): TeamUrlState {
  return {
    ...state,
    activities: (selection.status ?? []).filter((v): v is AnalystActivity =>
      (ACTIVITY_ORDER as readonly string[]).includes(v),
    ),
    languages: (selection.language ?? []).filter((v): v is Language => v === 'es' || v === 'pt'),
    teams: [...(selection.team ?? [])],
  }
}

function filterAnalystsBy(
  analysts: readonly TeamAnalyst[],
  selection: FilterSelection,
  except?: keyof typeof TEAM_TESTS,
): TeamAnalyst[] {
  const keys = Object.keys(TEAM_TESTS) as (keyof typeof TEAM_TESTS)[]
  return analysts.filter((analyst) =>
    keys.every((key) => {
      const values = selection[key] ?? []
      return (
        key === except || values.length === 0 || values.some((v) => TEAM_TESTS[key](analyst, v))
      )
    }),
  )
}

/** The analysts that pass the filters, in the server's order (activity, then name). */
export function filterAnalysts(
  analysts: readonly TeamAnalyst[],
  state: TeamUrlState,
): TeamAnalyst[] {
  return filterAnalystsBy(analysts, teamSelection(state))
}

/** The "Filtros" groups of "Equipo": Estado, Idioma, Equipo, with faceted counts. */
export function teamFilterGroups(
  overview: Pick<TeamOverview, 'analysts' | 'teams'>,
  state: TeamUrlState,
): FilterGroup[] {
  const selection = teamSelection(state)
  const count = (key: keyof typeof TEAM_TESTS, value: string) =>
    filterAnalystsBy(overview.analysts, selection, key).filter((a) => TEAM_TESTS[key](a, value))
      .length
  const teams = new Map<string, string>(overview.teams.map((team) => [team.id, team.name]))
  for (const analyst of overview.analysts) {
    if (!teams.has(analyst.team.id)) teams.set(analyst.team.id, analyst.team.name)
  }
  return [
    {
      key: 'status',
      legend: t('filters.status'),
      options: ACTIVITY_ORDER.map((activity) => ({
        value: activity,
        label: ACTIVITY_META[activity].label,
        count: count('status', activity),
      })),
    },
    {
      key: 'language',
      legend: t('filters.language'),
      options: QUEUE_LANGUAGES.map((language) => ({
        value: language,
        label: LANGUAGE_NATIVE_NAME[language],
        language,
        count: count('language', language),
      })),
    },
    {
      key: 'team',
      legend: t('filters.team'),
      options: [...teams.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], 'es', { sensitivity: 'base' }))
        .map(([id, name]) => ({ value: id, label: name, count: count('team', id) })),
    },
  ]
}

/** Header subtitle: "6 analistas" / "3 de 6 analistas". */
export function teamSubtitle(shown: number, total: number, filtered: boolean): string {
  return filtered
    ? t('team.subtitleFiltered', { shown, count: total })
    : t('team.subtitle', { count: total })
}

/** "Analistas" heading aside: "7 casos abiertos" and the risk ("2 en riesgo"). */
export function analystsFigures(
  analysts: readonly TeamAnalyst[],
  now: DateInput,
): { open: string; atRisk: number } {
  const open = analysts.reduce((sum, analyst) => sum + analyst.counts.open, 0)
  const atRisk = analysts.reduce((sum, analyst) => sum + atRiskCount(analyst.openCases, now), 0)
  return { open: t('analysts.openCases', { count: open }), atRisk }
}

/** The `CaseSummary` of `caseId` among the analysts' open cases, or null. */
export function findOpenCase(caseId: string, team: TeamOverview | undefined): CaseSummary | null {
  for (const analyst of team?.analysts ?? []) {
    const found = analyst.openCases.find((summary) => summary.id === caseId)
    if (found) return found
  }
  return null
}

// ── Reassign dialog (SuTeam, slice 9) ────────────────────────────────────────

/** Suggestions with no search; results when searching (team-generated: scales to big teams). */
export const SUGGESTIONS_LIMIT = 3
export const SEARCH_RESULTS_LIMIT = 6

const ACTIVITY_RANK: Record<AnalystActivity, number> = {
  available: 0,
  busy: 1,
  paused: 2,
  offline: 3,
}

/** Paused or offline: no new cases arrive (the dialog asks to confirm). */
export function isAway(analyst: Pick<TeamAnalyst, 'activity'>): boolean {
  return analyst.activity === 'paused' || analyst.activity === 'offline'
}

/**
 * Who may get the case (rule 3): only people who speak its language, never the current
 * holder; connected ones (available, then busy) unless `includeAway`; the least loaded
 * first, then the name.
 */
export function reassignPool(
  analysts: readonly TeamAnalyst[],
  summary: Pick<CaseSummary, 'language' | 'assignedAnalystId'>,
  { includeAway }: { includeAway: boolean },
): TeamAnalyst[] {
  return analysts
    .filter((analyst) => analyst.id !== summary.assignedAnalystId)
    .filter((analyst) => speaksLanguage(analyst, summary.language))
    .filter((analyst) => includeAway || !isAway(analyst))
    .sort((a, b) => {
      const away = Number(isAway(a)) - Number(isAway(b))
      if (away !== 0) return away
      const load = a.counts.open - b.counts.open
      if (load !== 0) return load
      const rank = ACTIVITY_RANK[a.activity] - ACTIVITY_RANK[b.activity]
      return rank !== 0 ? rank : byName(a, b) || a.id.localeCompare(b.id)
    })
}

export interface ReassignList {
  /** "Sugeridos" (no search) or "Resultados". */
  title: string
  shown: TeamAnalyst[]
  /** How many more match: "+2 más: escribe un nombre para encontrarlos". */
  hidden: number
}

/**
 * What the list shows: 3 suggestions, or up to 6 results for a search (accent- and
 * case-insensitive, by name). The chosen person always stays visible.
 */
export function reassignList(
  pool: readonly TeamAnalyst[],
  query: string,
  chosenId: string | null,
): ReassignList {
  const needle = foldText(query.trim())
  const matches = needle ? pool.filter((a) => foldText(a.name).includes(needle)) : pool.slice()
  const limit = needle ? SEARCH_RESULTS_LIMIT : SUGGESTIONS_LIMIT
  const shown = matches.slice(0, limit)
  const chosen = chosenId ? matches.find((a) => a.id === chosenId) : undefined
  if (chosen && !shown.includes(chosen)) shown.push(chosen)
  return {
    title: needle ? t('reassign.results') : t('reassign.suggested'),
    shown,
    hidden: matches.length - shown.length,
  }
}

export function moreResultsLabel(hidden: number): string | null {
  return hidden > 0 ? t('reassign.more', { hidden }) : null
}

export function noMatchCopy(language: Language): string {
  return t('reassign.noMatch', { language: LANGUAGE_NAMES[language] })
}

export function onlySpeakersCopy(language: Language): string {
  return t('reassign.onlySpeakers', { language: LANGUAGE_NAMES[language] })
}

export function includeAwayLabel(): string {
  return t('reassign.includeAway')
}

/** "2 abiertos". */
export function openCountLabel(analyst: Pick<TeamAnalyst, 'counts'>): string {
  return t('reassign.openCount', { count: analyst.counts.open })
}

/** A paused or offline choice needs "Pasarlo aunque esté en pausa" (slice 3 rule 8). */
export function needsPauseConfirmation(analyst: Pick<TeamAnalyst, 'activity'>): boolean {
  return isAway(analyst)
}

export function confirmPausedLabel(): string {
  return t('reassign.confirmPaused')
}

/** Warning shown when the chosen person is paused (offline adds the missing session). */
export function pausedWarning(analyst: Pick<TeamAnalyst, 'name' | 'activity'>): string {
  const name = firstName(analyst.name)
  return analyst.activity === 'offline'
    ? t('reassign.pausedWarningOffline', { name })
    : t('reassign.pausedWarning', { name })
}

/**
 * The notice the customer gets on a reassignment, in the case language (never the UI's):
 * chat content, not UI copy. It must stay identical to the backend text (slice 3 §3.5); a
 * model test pins it.
 */
export const REASSIGNED_NOTICE: Record<Language, (firstName: string) => string> = {
  // i18n-ignore-next-line: chat content in the case language, mirrored from the backend
  es: (name) => `Ahora te atiende ${name}, de nuestro equipo.`,
  // i18n-ignore-next-line: chat content in the case language, mirrored from the backend
  pt: (name) => `Agora quem te atende é ${name}, da nossa equipe.`,
}

export function customerSeesCopy(
  summary: Pick<CaseSummary, 'language'>,
  analyst: Pick<TeamAnalyst, 'name'>,
): string {
  return REASSIGNED_NOTICE[summary.language](firstName(analyst.name))
}

/** Primary button: "Reasignar a Daniela" ("Reasignar" with nobody chosen). */
export function reassignSubmitLabel(analyst: Pick<TeamAnalyst, 'name'> | null): string {
  return analyst ? t('reassign.submitTo', { name: firstName(analyst.name) }) : t('actions.reassign')
}

export function pickAnalystError(): string {
  return t('reassign.pickError')
}

export function confirmPausedError(): string {
  return t('reassign.confirmError')
}

/** What the dialog does after a failure. */
export type AssignFailureAction = 'none' | 'confirm_paused' | 'refetch' | 'close' | 'refetch_team'

export interface AssignFailure {
  message: string
  action: AssignFailureAction
}

export function describeAssignFailure(
  error: unknown,
  context: { caseLanguage: Language; analystName: string },
): AssignFailure {
  const name = firstName(context.analystName)
  if (isApiProblem(error)) {
    switch (error.code) {
      case 'language_mismatch': {
        const fromServer = error.stringExtension('caseLanguage')
        const language =
          fromServer === 'es' || fromServer === 'pt' ? fromServer : context.caseLanguage
        return {
          message: t('reassign.failure.languageMismatch', {
            language: LANGUAGE_NAMES[language],
            name,
          }),
          action: 'none',
        }
      }
      case 'analyst_paused':
        return {
          message: t('reassign.failure.analystPaused', { name, confirm: confirmPausedLabel() }),
          action: 'confirm_paused',
        }
      case 'assignment_changed':
        return {
          message: t('reassign.failure.assignmentChanged'),
          action: 'refetch',
        }
      case 'case_closed':
        return { message: t('reassign.failure.caseClosed'), action: 'close' }
      case 'analyst_not_eligible':
        return { message: t('reassign.failure.notEligible'), action: 'refetch_team' }
      default:
        break
    }
  }
  return { message: t('reassign.failure.generic'), action: 'none' }
}

/** The "Listo ·" strip after a reassignment. */
export function reassignResultCopy(input: {
  customerName: string
  previousAnalystName: string | null
  analystName: string
}): { prefix: string; message: string } {
  const message = input.previousAnalystName
    ? t('reassign.movedFromTo', {
        customer: input.customerName,
        from: input.previousAnalystName,
        to: input.analystName,
      })
    : t('reassign.movedTo', { customer: input.customerName, to: input.analystName })
  return { prefix: done(), message }
}

/** Toast after reassigning from the case view. */
export function reassignedToastTitle(customerName: string, analystName: string): string {
  return t('reassign.movedToast', { customer: customerName, to: analystName })
}

/** Info toast when the chosen analyst already had the case (200 no-op). */
export function unchangedToastTitle(analystName: string): string {
  return t('reassign.unchanged', { name: firstName(analystName) })
}

// ── "Escalados" (slice 9) ────────────────────────────────────────────────────

export interface EscalationGroup {
  key: 'open' | 'attended'
  label: string
  items: EscalationItem[]
}

/**
 * "Abiertos (n)" (the longest waiting first) and "Atendidos hoy" (supervision attended
 * them today in the viewer's zone, the most recent first). Withdrawn ones and those that
 * ended with the case are never listed.
 */
export function escalationGroups(
  items: readonly EscalationItem[],
  now: DateInput,
): EscalationGroup[] {
  const open = items
    .filter((item) => item.escalation.state === 'open')
    .sort((a, b) => toMs(a.escalation.escalatedAt) - toMs(b.escalation.escalatedAt))
  const today = localDayKey(now)
  const attended = items
    .filter(
      (item) =>
        (item.escalation.state === 'answered' ||
          item.escalation.state === 'taken' ||
          item.escalation.state === 'reassigned') &&
        item.escalation.resolvedAt !== null &&
        localDayKey(item.escalation.resolvedAt) === today,
    )
    .sort((a, b) => toMs(b.escalation.resolvedAt ?? 0) - toMs(a.escalation.resolvedAt ?? 0))
  const groups: EscalationGroup[] = []
  if (open.length) {
    groups.push({
      key: 'open',
      label: t('escalations.groups.open', { total: open.length }),
      items: open,
    })
  }
  if (attended.length) {
    groups.push({ key: 'attended', label: t('escalations.groups.attended'), items: attended })
  }
  return groups
}

/** "2 abiertos" / "1 abierto" (header aside). */
export function openEscalationsLabel(count: number): string {
  return t('escalations.open', { count })
}

/** "Escaló hace 6 min" (the panel's time fact). */
export function escalatedAgo(escalation: Pick<Escalation, 'escalatedAt'>, now: DateInput): string {
  return t('escalations.escalatedAgo', { ago: formatRelativeTime(escalation.escalatedAt, now) })
}

/**
 * What supervision did, from the viewer's side: "Respondiste a Daniela" / "Lucía Herrera
 * respondió", "Tomaste el caso" / "… tomó el caso", "Lo reasignaste a …" / "… lo
 * reasignó a …". `null` while it is open.
 */
export function escalationOutcomeTitle(escalation: Escalation, meId: string): string | null {
  const mine = escalation.resolvedById === meId
  const who = escalation.resolvedByName ?? supervisionName()
  switch (escalation.state) {
    case 'answered':
      return mine
        ? t('escalations.outcome.answeredMine', { name: escalatorName(escalation) })
        : t('escalations.outcome.answeredOther', { who })
    case 'taken':
      return mine
        ? t('escalations.outcome.takenMine')
        : t('escalations.outcome.takenOther', { who })
    case 'reassigned': {
      const to = escalation.reassignedToName ?? t('someoneElse')
      return mine
        ? t('escalations.outcome.reassignedMine', { to })
        : t('escalations.outcome.reassignedOther', { who, to })
    }
    default:
      return null
  }
}

/** The "El caso" facts of the panel (icon + short value; the label is for screen readers). */
export function escalationCaseFacts(
  input: {
    summary: CaseSummary
    holderName: string | null
    customer: Pick<CaseCustomer, 'city' | 'country'> | null
  },
  now: DateInput,
): FactItem[] {
  const { summary, customer } = input
  const place = customer ? `${customer.city}, ${countryName(customer.country)}` : null
  const facts: (FactItem | null)[] = [
    {
      key: 'holder',
      icon: 'user',
      text: input.holderName ?? t('unassigned'),
      label: t('escalations.facts.holder'),
    },
    place
      ? { key: 'place', icon: 'map-pin', text: place, label: t('escalations.facts.place') }
      : null,
    {
      key: 'language',
      icon: 'languages',
      text: LANGUAGE_NATIVE_NAME[summary.language],
      language: summary.language,
      label: t('escalations.facts.language'),
    },
    {
      key: 'channel',
      icon: caseChannel(summary.channel).icon,
      text: channelLabel(summary.channel),
      label: t('escalations.facts.channel'),
    },
    {
      key: 'priority',
      icon: CASE_PRIORITY[summary.priority].icon,
      text: CASE_PRIORITY[summary.priority].label,
      label: t('escalations.facts.priority'),
    },
    {
      key: 'open-for',
      icon: 'clock',
      text: openForText(summary, now),
      label: t('escalations.facts.openFor'),
    },
  ]
  return facts.filter((fact): fact is FactItem => fact !== null)
}

/** The "Listo" strip after acting on an escalation. */
export function escalationResultCopy(
  kind: 'answered' | 'taken' | 'reassigned',
  item: { analystName: string; customerName: string; toName?: string },
): { prefix: string; message: string } {
  const analyst = firstName(item.analystName)
  switch (kind) {
    case 'answered':
      return {
        prefix: done(),
        message: t('escalations.result.answered', { analyst, customer: item.customerName }),
      }
    case 'taken':
      return {
        prefix: done(),
        message: t('escalations.result.taken', { analyst, customer: item.customerName }),
      }
    case 'reassigned':
      return {
        prefix: done(),
        message: t('reassign.movedFromTo', {
          customer: item.customerName,
          from: item.analystName,
          to: item.toName ?? t('someoneElse'),
        }),
      }
  }
}

export function replyRequiredError(): string {
  return t('escalations.replyRequired')
}

/** "Daniela" (who escalated), or "quien escaló". */
function escalatorName(escalation: Pick<Escalation, 'escalatedByName'>): string {
  return firstName(escalation.escalatedByName ?? t('escalations.whoEscalated'))
}

/** "Tu respuesta para Daniela". */
export function replyLabel(escalation: Pick<Escalation, 'escalatedByName'>): string {
  return t('escalations.replyLabel', { name: escalatorName(escalation) })
}

/** "Le llega a Daniela dentro del caso. El cliente no la ve." */
export function replyHelp(escalation: Pick<Escalation, 'escalatedByName'>): string {
  return t('escalations.replyHelp', { name: escalatorName(escalation) })
}

export interface EscalationFailure {
  message: string
  /** Refetch "Escalados" (the escalation changed meanwhile). */
  refetch: boolean
}

export function describeEscalationFailure(
  error: unknown,
  context: { caseLanguage: Language },
): EscalationFailure {
  if (isApiProblem(error)) {
    switch (error.code) {
      case 'escalation_not_open':
        return {
          message: t('escalations.failure.notOpen'),
          refetch: true,
        }
      case 'analyst_not_eligible':
        return {
          message: t('escalations.failure.notEligible'),
          refetch: false,
        }
      case 'language_mismatch':
        return {
          message: t('escalations.failure.languageMismatch', {
            language: LANGUAGE_NAMES[context.caseLanguage],
          }),
          refetch: false,
        }
      case 'case_closed':
        return { message: t('escalations.failure.caseClosed'), refetch: true }
      case 'validation_error':
        return { message: t('escalations.failure.validation'), refetch: false }
      case 'network_error':
        return { message: connectionHint(), refetch: false }
      default:
        break
    }
  }
  return { message: t('escalations.failure.generic'), refetch: false }
}

// ── Supervisor case view ─────────────────────────────────────────────────────

/** Where "Volver" goes from the case view, by the screen it came from. */
export function backLabelFor(from: string | null): string {
  return t('caseView.back', { place: i18n.t(`shell:nav.${backPlace(from)}`) })
}

function backPlace(from: string | null): 'queues' | 'audit' | 'team' | 'escalations' {
  if (!from) return 'queues'
  if (from.startsWith(PATHS.supervision.audit)) return 'audit'
  if (from.startsWith(PATHS.supervision.team)) return 'team'
  if (from.startsWith(PATHS.supervision.escalations)) return 'escalations'
  return 'queues'
}

/** "CASE-…0101" under a customer's name. */
export { shortCaseId }

// ── "Calificación 7 días" (slice 7: customer ratings 1–4) ─────────────────────

export interface RecentRatingCell {
  /** The face of the rounded average (1–4). */
  icon: FactIcon
  /** < 2.5 danger, < 3 warn, else success. */
  tone: FactTone
  /** One decimal with a comma: "3,6". */
  average: string
  /** Muted after it: "(9)". */
  count: string
  /** "Promedio 3,6 de 4 en 9 casos calificados". */
  tooltip: string
}

/** "3,6" (one decimal, Spanish comma). */
export function formatRatingAverage(average: number): string {
  return average.toFixed(1).replace('.', ',')
}

/**
 * The analyst's 7-day rating cell: face + average + count, with the tooltip that spells
 * it out; `null` when no case she closed in the window was rated ("—").
 */
export function recentRatingCell(stats: RatingStats): RecentRatingCell | null {
  if (stats.count <= 0 || stats.average === null) return null
  const average = formatRatingAverage(stats.average)
  const tone: FactTone = stats.average < 2.5 ? 'danger' : stats.average < 3 ? 'warn' : 'success'
  return {
    icon: ratingOption(stats.average).icon,
    tone,
    average,
    count: `(${stats.count})`,
    tooltip: t('rating.tooltip', { average, count: stats.count }),
  }
}

/** Header tooltip of the column. */
export const RECENT_RATING_HEADER: {
  readonly label: string
  readonly title: string
  readonly empty: string
} = {
  get label() {
    return t('rating.header')
  },
  get title() {
    return t('rating.headerTitle')
  },
  get empty() {
    return t('rating.empty')
  },
}

/** Teams by id → name (the analyst sheet's team fact). */
export function teamNames(teams: readonly TeamSummary[]): Record<string, string> {
  return Object.fromEntries(teams.map((team) => [team.id, team.name]))
}

/** A fact without its list `key` (React keys never travel in a spread). */
export function withoutKey<T extends { key: string }>(fact: T): Omit<T, 'key'> {
  const { key: _key, ...rest } = fact
  return rest
}

// ── "Tomar el caso" from the assistant (slice 19) ────────────────────────────

/** "Tomar el caso de Ximena Robles" (the row button's accessible name). */
export function takeFromAssistantLabel(customerName: string): string {
  return t('actions.takeOf', { name: customerName })
}

/** The confirmation toast: where the case went. */
export function takenFromAssistantToast(summary: Pick<CaseSummary, 'status' | 'language'>): {
  title: string
  description: string
} {
  return {
    title: t('release.takenTitle'),
    description:
      summary.status === 'queued'
        ? t('release.takenQueued', { language: LANGUAGE_NAMES[summary.language] })
        : t('release.takenHeld'),
  }
}

export function describeReleaseFailure(error: unknown): { title: string; description: string } {
  if (isApiProblem(error, 'assistant_not_active')) {
    return {
      title: t('release.notActiveTitle'),
      description: t('release.notActiveText'),
    }
  }
  if (isApiProblem(error, 'network_error')) {
    return {
      title: t('release.failedTitle'),
      description: connectionHint(),
    }
  }
  return { title: t('release.failedTitle'), description: t('release.retryLater') }
}
