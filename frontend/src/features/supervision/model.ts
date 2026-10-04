/**
 * Pure rules and copy of supervision (SuTeam.dc.html, SuAvisoNueva.dc.html;
 * contract docs/platform/api/slice-3-supervision.md §2, §8.4–§8.9): the "Ahora"
 * states, the team filters, the queue and analyst figures (time-dependent ones
 * take `now`), the assign dialog (candidates, rule 3, the pause confirmation,
 * what the customer sees, failures), the result copy, the queue notice and the
 * URL state. No React, no I/O: unit-tested in model.test.ts.
 */
import type { Tone } from '@/components/ui'
import { channelLabel, formatSla, priorityLabel } from '@/features/cases'
import {
  LANGUAGE_NAMES,
  QUEUE_LABEL,
  formatWait,
  queueInSentence,
  shortCaseId,
} from '@/features/conversation'
import { isApiProblem } from '@/lib/api'
import { pluralize } from '@/lib/format'
import type {
  AnalystActivity,
  CaseSummary,
  Language,
  LanguageQueue,
  QueueOverview,
  TeamAnalyst,
  TeamOverview,
  TeamSummary,
} from './types'

export { QUEUE_LABEL }

/** "Carga alta" from this many open cases (team-generated, contract §1.2). */
export const HIGH_LOAD_OPEN_CASES = 5

type DateInput = Date | string | number

const toMs = (value: DateInput) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime()

/** "Daniela" from "Daniela Ríos". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
}

// ── "Ahora" (contract §2.2) ──────────────────────────────────────────────────

export interface ActivityMeta {
  label: string
  tone: Tone
}

export const ACTIVITY_META: Record<AnalystActivity, ActivityMeta> = {
  busy: { label: 'Atendiendo', tone: 'success' },
  available: { label: 'Disponible', tone: 'accent' },
  paused: { label: 'En pausa', tone: 'warn' },
  offline: { label: 'Sin conexión', tone: 'neutral' },
}

/** Hint of an available analyst without a session: cases keep landing on her. */
export const NO_SESSION_HINT = {
  label: 'sin sesión abierta',
  title: 'Le siguen llegando casos aunque no haya iniciado sesión.',
} as const

export function showsNoSessionHint(analyst: Pick<TeamAnalyst, 'activity' | 'signedIn'>): boolean {
  return (analyst.activity === 'busy' || analyst.activity === 'available') && !analyst.signedIn
}

// ── Team and activity filters (contract §8.4) ─────────────────────────────────

export type ActivityFilter = 'connected' | 'paused' | 'offline'

export interface ActivityFilterOption {
  value: ActivityFilter
  label: string
  /** `?estado=` slug. */
  slug: string
}

/**
 * Canvas pills: "Conectadas" (Atendiendo + Disponible) · "En pausa" ·
 * "Desconectadas". Plural, implying "personas"; a person's own state is the
 * gender-neutral "Sin conexión" (ACTIVITY_META).
 */
export const ACTIVITY_FILTERS: readonly ActivityFilterOption[] = [
  { value: 'connected', label: 'Conectadas', slug: 'conectadas' },
  { value: 'paused', label: 'En pausa', slug: 'en-pausa' },
  { value: 'offline', label: 'Desconectadas', slug: 'desconectadas' },
]

export function activityFilterOf(activity: AnalystActivity): ActivityFilter {
  if (activity === 'paused') return 'paused'
  if (activity === 'offline') return 'offline'
  return 'connected'
}

/** The analysts of one team (`null` = every team). */
export function analystsOfTeam(
  analysts: readonly TeamAnalyst[],
  teamId: string | null,
): TeamAnalyst[] {
  return teamId ? analysts.filter((a) => a.team.id === teamId) : analysts.slice()
}

export function analystsInFilter(
  analysts: readonly TeamAnalyst[],
  filter: ActivityFilter,
): TeamAnalyst[] {
  return analysts.filter((a) => activityFilterOf(a.activity) === filter)
}

/** Pill counts (after the team filter). */
export function countByFilter(analysts: readonly TeamAnalyst[]): Record<ActivityFilter, number> {
  const counts: Record<ActivityFilter, number> = { connected: 0, paused: 0, offline: 0 }
  for (const analyst of analysts) counts[activityFilterOf(analyst.activity)] += 1
  return counts
}

/**
 * The team of `?equipo=` (a `TEAM-…` id), or null for "Todos los equipos"
 * (unknown ids too, e.g. an old slice 3 slug URL).
 */
export function selectedTeam(
  teams: readonly TeamSummary[],
  teamId: string | null,
): TeamSummary | null {
  return teamId ? (teams.find((team) => team.id === teamId) ?? null) : null
}

/**
 * Pill labels by team id: the team names without the prefix they all share
 * ("Equipo Andes" → "Equipo Andes"), or the full names otherwise.
 */
export function teamPillLabels(teams: readonly TeamSummary[]): Record<string, string> {
  const prefixOf = (name: string) => {
    const at = name.indexOf(' · ')
    return at > 0 ? name.slice(0, at + 3) : null
  }
  const first = teams[0] ? prefixOf(teams[0].name) : null
  const shared = first !== null && teams.every((team) => team.name.startsWith(first))
  return Object.fromEntries(
    teams.map((team) => [team.id, shared ? team.name.slice(first.length) : team.name]),
  )
}

/** Header subtitle: "Equipo Andes · 3 analistas" / "Todos los equipos · 6 analistas". */
export function teamSubtitle(team: TeamSummary | null, analystCount: number): string {
  return `${team?.name ?? 'Todos los equipos'} · ${pluralize(analystCount, 'analista')}`
}

// ── Languages ───────────────────────────────────────────────────────────────

/** "cola en portugués": the queue label inside a sentence. */
export function queueNameInSentence(language: Language): string {
  const label = QUEUE_LABEL[language]
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}`
}

/** "español, portugués". */
export function languagesLabel(languages: readonly Language[]): string {
  return languages.map((language) => LANGUAGE_NAMES[language]).join(', ')
}

export function speaksLanguage(
  analyst: Pick<TeamAnalyst, 'languages'>,
  language: Language,
): boolean {
  return analyst.languages.includes(language)
}

// ── Time-dependent figures (recomputed with the ticking clock, §2.3) ─────────

/**
 * Time since `since`: seconds under a minute, whole minutes above ("4 min",
 * "1 h 05 min"), so a clock that ticks every few seconds does not make the
 * figure jitter.
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

/** "Analistas" heading aside: "7 casos abiertos · 2 en riesgo de SLA". */
export function analystsSummary(analysts: readonly TeamAnalyst[], now: DateInput): string {
  const open = analysts.reduce((sum, analyst) => sum + analyst.counts.open, 0)
  const atRisk = analysts.reduce((sum, analyst) => sum + atRiskCount(analyst.openCases, now), 0)
  return `${pluralize(open, 'caso abierto', 'casos abiertos')} · ${atRisk} en riesgo de SLA`
}

// ── Queues (contract §8.4) ───────────────────────────────────────────────────

/** "1 en riesgo de SLA" / "Sin riesgo". */
export function queueRiskText(atRisk: number): string {
  return atRisk > 0 ? `${atRisk} en riesgo de SLA` : 'Sin riesgo'
}

/** "el más antiguo": the oldest wait, or "—" for an empty queue. */
export function queueOldestWait(
  queue: Pick<LanguageQueue, 'oldestQueuedAt'>,
  now: DateInput,
): string {
  return queue.oldestQueuedAt ? waitSince(queue.oldestQueuedAt, now) : '—'
}

/** Caption under the available speakers: "disponibles que hablan portugués". */
export function speakersCaption(count: number, language: Language): string {
  return count === 1
    ? `disponible que habla ${LANGUAGE_NAMES[language]}`
    : `disponibles que hablan ${LANGUAGE_NAMES[language]}`
}

/** "Espera 13 min" on a queued case (it waits since it opened). */
export function queuedWaitLabel(summary: Pick<CaseSummary, 'openedAt'>, now: DateInput): string {
  return `Espera ${waitSince(summary.openedAt, now)}`
}

// ── Analyst sheet (contract §8.4) ────────────────────────────────────────────

/** Sheet subtitle: "En pausa · español · Equipo Andes". */
export function analystSheetDescription(analyst: TeamAnalyst): string {
  return [
    ACTIVITY_META[analyst.activity].label,
    languagesLabel(analyst.languages),
    analyst.team.name,
  ].join(' · ')
}

/** Case row line: "Prioridad media · Web · español". */
export function caseRowLine(
  summary: Pick<CaseSummary, 'priority' | 'channel' | 'language'>,
): string {
  return [
    priorityLabel(summary.priority),
    channelLabel(summary.channel),
    LANGUAGE_NAMES[summary.language],
  ].join(' · ')
}

/** The `CaseSummary` of `caseId` in the cached overviews (queued or someone's open case). */
export function findCaseSummary(
  caseId: string,
  team: TeamOverview | undefined,
  queues: QueueOverview | undefined,
): CaseSummary | null {
  for (const queue of queues?.queues ?? []) {
    const found = queue.cases.find((summary) => summary.id === caseId)
    if (found) return found
  }
  for (const analyst of team?.analysts ?? []) {
    const found = analyst.openCases.find((summary) => summary.id === caseId)
    if (found) return found
  }
  return null
}

// ── Assign dialog (contract §8.6) ────────────────────────────────────────────

/** Queued (nobody holds it) → "Asignar"; held → "Reasignar". */
export function isReassignment(summary: Pick<CaseSummary, 'assignedAnalystId'>): boolean {
  return summary.assignedAnalystId !== null
}

export function assignDialogTitle(summary: Pick<CaseSummary, 'assignedAnalystId'>): string {
  return isReassignment(summary) ? 'Reasignar caso' : 'Asignar caso'
}

/**
 * "Rosa Elena Ibarra Méndez · CASE-…0111 · español · Espera 13 min en la cola" /
 * "… · Lo atiende Julián Ortega".
 */
export function assignDialogSubtitle(
  summary: Pick<CaseSummary, 'id' | 'customer' | 'language' | 'openedAt' | 'assignedAnalystId'>,
  holderName: string | null,
  now: DateInput,
): string {
  const state = isReassignment(summary)
    ? `Lo atiende ${holderName ?? 'otra persona del equipo'}`
    : `Espera ${waitSince(summary.openedAt, now)} en la cola`
  return [
    summary.customer.displayName,
    shortCaseId(summary.id),
    LANGUAGE_NAMES[summary.language],
    state,
  ].join(' · ')
}

/** Order of the "¿A quién?" options by activity: who can answer now first. */
const CANDIDATE_ACTIVITY_ORDER: Record<AnalystActivity, number> = {
  available: 0,
  busy: 1,
  paused: 2,
  offline: 3,
}

export interface AssignCandidate {
  value: string
  label: string
  description: string
  /** Does not speak the case language (rule 3): listed, but not selectable. */
  disabled: boolean
  analyst: TeamAnalyst
}

/** "En pausa · 2 abiertos · español", or "No habla portugués (regla 3)". */
export function candidateDescription(analyst: TeamAnalyst, language: Language): string {
  if (!speaksLanguage(analyst, language)) {
    return `No habla ${LANGUAGE_NAMES[language]} (regla 3)`
  }
  return [
    ACTIVITY_META[analyst.activity].label,
    pluralize(analyst.counts.open, 'abierto'),
    languagesLabel(analyst.languages),
  ].join(' · ')
}

/**
 * "¿A quién?": every listed analyst except the current assignee; speakers of
 * the case language first, then available, busy, paused, offline, then fewer
 * open cases, then name. Non-speakers stay listed but disabled (rule 3).
 */
export function assignCandidates(
  analysts: readonly TeamAnalyst[],
  summary: Pick<CaseSummary, 'language' | 'assignedAnalystId'>,
): AssignCandidate[] {
  const language = summary.language
  return analysts
    .filter((analyst) => analyst.id !== summary.assignedAnalystId)
    .sort((a, b) => {
      const speaks = Number(speaksLanguage(b, language)) - Number(speaksLanguage(a, language))
      if (speaks !== 0) return speaks
      const activity = CANDIDATE_ACTIVITY_ORDER[a.activity] - CANDIDATE_ACTIVITY_ORDER[b.activity]
      if (activity !== 0) return activity
      const load = a.counts.open - b.counts.open
      return load !== 0 ? load : byName(a, b) || a.id.localeCompare(b.id)
    })
    .map((analyst) => ({
      value: analyst.id,
      label: analyst.name,
      description: candidateDescription(analyst, language),
      disabled: !speaksLanguage(analyst, language),
      analyst,
    }))
}

/** A paused or offline target needs "Asignar aunque esté en pausa" (rule 8 of §3.3). */
export function needsPauseConfirmation(analyst: Pick<TeamAnalyst, 'activity'>): boolean {
  return analyst.activity === 'paused' || analyst.activity === 'offline'
}

export const CONFIRM_PAUSED_LABEL = 'Asignar aunque esté en pausa'

/** Warning shown when the chosen analyst is paused (offline adds the missing session). */
export function pausedWarning(analyst: Pick<TeamAnalyst, 'name' | 'activity'>): string {
  const base = `${firstName(analyst.name)} está en pausa: no recibe casos nuevos. Si lo asignas igual, le llega a su lista.`
  return analyst.activity === 'offline' ? `${base} Tampoco tiene una sesión abierta.` : base
}

/**
 * The notice the customer gets on a reassignment, in the case language. It must
 * stay identical to the backend text (contract §3.5); a model test pins it.
 */
export const REASSIGNED_NOTICE: Record<Language, (firstName: string) => string> = {
  es: (name) => `Ahora te atiende ${name}, de nuestro equipo.`,
  pt: (name) => `Agora quem te atende é ${name}, da nossa equipe.`,
}

/** "El cliente verá": the header change (from the queue) or the reassignment notice. */
export function customerSeesCopy(
  summary: Pick<CaseSummary, 'language' | 'assignedAnalystId'>,
  analyst: Pick<TeamAnalyst, 'name'>,
): string {
  const name = firstName(analyst.name)
  return isReassignment(summary)
    ? REASSIGNED_NOTICE[summary.language](name)
    : `Que ya lo atiende ${name}.`
}

/** Primary button: "Asignar a Daniela" / "Reasignar a Daniela" ("Asignar" with nobody chosen). */
export function assignSubmitLabel(
  summary: Pick<CaseSummary, 'assignedAnalystId'>,
  analyst: Pick<TeamAnalyst, 'name'> | null,
): string {
  const verb = isReassignment(summary) ? 'Reasignar' : 'Asignar'
  return analyst ? `${verb} a ${firstName(analyst.name)}` : verb
}

export const PICK_ANALYST_ERROR = 'Elige a quién asignarlo.'
export const CONFIRM_PAUSED_ERROR = 'Confirma que quieres asignarlo aunque esté en pausa.'

/** What the dialog does after a failure (contract §8.6). */
export type AssignFailureAction =
  /** Nothing else: the message is enough. */
  | 'none'
  /** Show the pause checkbox and focus it. */
  | 'confirm_paused'
  /** Refetch team, queues and the case; keep the dialog open with fresh data. */
  | 'refetch'
  /** Close the dialog and refetch. */
  | 'close'
  /** Refetch the team (the analyst list changed). */
  | 'refetch_team'

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
          message: `Ese caso es en ${LANGUAGE_NAMES[language]} y ${name} no lo habla (regla 3).`,
          action: 'none',
        }
      }
      case 'analyst_paused':
        return {
          message: `${name} está en pausa. Marca «${CONFIRM_PAUSED_LABEL}» para seguir.`,
          action: 'confirm_paused',
        }
      case 'assignment_changed':
        return {
          message:
            'Alguien más movió este caso mientras decidías. Revisa a quién está asignado ahora.',
          action: 'refetch',
        }
      case 'case_closed':
        return { message: 'Este caso ya se cerró.', action: 'close' }
      case 'analyst_not_eligible':
        return { message: 'Esa persona ya no puede recibir casos.', action: 'refetch_team' }
      default:
        break
    }
  }
  return { message: 'No pudimos asignar el caso. Inténtalo de nuevo.', action: 'none' }
}

// ── After a successful assignment (contract §8.4–§8.6) ──────────────────────

export interface AssignResultInput {
  customerName: string
  analystName: string
  /** Who held it before; null when it came from the queue. */
  previousAnalystName: string | null
  /** The queue it left (from the queue only). */
  queueLanguage: Language
  /** Cases left in that queue. */
  queueRemaining: number
}

/** The "Listo ·" strip of the team screen. */
export function assignResultCopy(input: AssignResultInput): { prefix: string; message: string } {
  const message = input.previousAnalystName
    ? `El caso de ${input.customerName} pasó de ${input.previousAnalystName} a ${input.analystName}.`
    : `El caso de ${input.customerName} pasó a ${input.analystName}. La ${queueNameInSentence(input.queueLanguage)} quedó en ${input.queueRemaining}.`
  return { prefix: 'Listo ·', message }
}

/** Toast after assigning from the case view or the analyst sheet. */
export function assignedToastTitle(customerName: string, analystName: string): string {
  return `Listo · El caso de ${customerName} pasó a ${analystName}`
}

/** Info toast when the chosen analyst already had the case (200 no-op). */
export function unchangedToastTitle(analystName: string): string {
  return `${firstName(analystName)} ya tenía este caso.`
}

// ── Supervisor notice (SuAvisoNueva, contract §8.7) ──────────────────────────

/** Toast on `queue.case_queued`: "Un caso espera en la cola en portugués". */
export function queuedNoticeCopy(summary: Pick<CaseSummary, 'language' | 'customer'>): {
  tag: string
  title: string
  description: string
} {
  const label = QUEUE_LABEL[summary.language]
  return {
    tag: label,
    title: `Un caso espera en ${queueInSentence(label)}`,
    description: `${summary.customer.displayName} · nadie disponible habla ${LANGUAGE_NAMES[summary.language]}`,
  }
}

// ── URL state (frozen, contract §8.9) ────────────────────────────────────────

export interface TeamUrlState {
  /** `?equipo=<TeamSummary.id>` (`TEAM-…`); unknown → treated as all (`selectedTeam`). */
  team: string | null
  /** `?estado=conectadas|en-pausa|desconectadas` (default conectadas). */
  activity: ActivityFilter
  /** `?analista=STF-…`: the analyst sheet. */
  analystId: string | null
  /** `?asignar=CASE-…`: the assign dialog. */
  assignCaseId: string | null
}

export interface CaseViewUrlState {
  /** `?historial=lista|CASE-…`: the "Casos anteriores" sheet. */
  history: 'lista' | string | null
  /** `?asignar=1`: the assign dialog for this case. */
  assign: boolean
}

export interface UrlStateChangeOptions {
  /** Replace the history entry (filters) instead of pushing one (selection, dialogs). */
  replace?: boolean
}

const trimmed = (value: string | null) => value?.trim() || null

export function parseTeamSearch(params: URLSearchParams): TeamUrlState {
  const slug = params.get('estado')
  return {
    team: trimmed(params.get('equipo')),
    activity: ACTIVITY_FILTERS.find((option) => option.slug === slug)?.value ?? 'connected',
    analystId: trimmed(params.get('analista')),
    assignCaseId: trimmed(params.get('asignar')),
  }
}

export function toTeamSearch(state: TeamUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.team) params.set('equipo', state.team)
  if (state.activity !== 'connected') {
    const slug = ACTIVITY_FILTERS.find((option) => option.value === state.activity)?.slug
    if (slug) params.set('estado', slug)
  }
  if (state.analystId) params.set('analista', state.analystId)
  if (state.assignCaseId) params.set('asignar', state.assignCaseId)
  return params
}

export function parseCaseViewSearch(params: URLSearchParams): CaseViewUrlState {
  return {
    history: trimmed(params.get('historial')),
    assign: params.get('asignar') === '1',
  }
}

export function toCaseViewSearch(state: CaseViewUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.history) params.set('historial', state.history)
  if (state.assign) params.set('asignar', '1')
  return params
}
