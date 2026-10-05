/**
 * Pure rules of a proposal to change an agent (slice 22 on slice 16's registry): its state as a
 * glyph and a word, the steps from draft to an active agent, where it came from, what the draft
 * changes, which evaluation suite tests it, the test report, and every builder failure in words.
 * No React, no I/O: proposals.test.ts.
 */
import type { LanguageCode, StatusAppearance } from '@/components/ui'
import { isApiProblem } from '@/lib/api'
import { i18n } from '@/lib/i18n'
import type {
  EntityDraft,
  EvalReport,
  GateItem,
  ProposalHistoryEntry,
  ProposalState,
  ReasonCode,
  ReleaseDetail,
  Violation,
  YardstickChange,
} from './types'

const t = i18n.getFixedT(null, 'automation')

/** The registry's states, in order (agent-core ADR 0018). */
export const PROPOSAL_STATES: readonly ProposalState[] = [
  'draft',
  'candidate',
  'evaluated',
  'approved',
  'published',
]

const STATE_LOOK: Record<ProposalState, Omit<StatusAppearance, 'label'>> = {
  draft: { shape: 'dashed', tone: 'neutral' },
  candidate: { shape: 'pie-25', tone: 'accent' },
  evaluated: { shape: 'pie-50', tone: 'accent' },
  approved: { shape: 'pie-75', tone: 'accent' },
  published: { shape: 'check', tone: 'success' },
}

function isProposalState(state: string): state is ProposalState {
  return (PROPOSAL_STATES as readonly string[]).includes(state)
}

/** A proposal state as Linear shows it (glyph + word). An unknown state reads as such. */
export function proposalStatus(state: string): StatusAppearance {
  if (!isProposalState(state)) {
    return { shape: 'ring', tone: 'neutral', label: t('proposals.state.unknown') }
  }
  return { ...STATE_LOOK[state], label: t(`proposals.state.${state}`) }
}

export type StepKey = ProposalState | 'active'

export interface ProposalStep {
  key: StepKey
  label: string
  state: 'done' | 'current' | 'later'
}

/**
 * What ends a published proposal. `activate`: the first agent of a case type ("Activar": `prod`
 * points at the release and the type records that the agent serves it). `promote`: a new version
 * of an agent that already runs in production ("Pasar a producción": only `prod` moves; the
 * improvement engine's proposals patch such agents).
 */
export type EndStep = 'activate' | 'promote'

export interface EndStepFacts {
  /** The agent state of the case type the URL names (null without one). */
  typeAgent: string | null
  /** That type is served by this proposal's agent. */
  servesThisAgent: boolean
  /** The agent's `prod` alias points somewhere (undefined while unknown). */
  inProduction: boolean | undefined
  /** `prod` points at this proposal's release (null when its release is not known). */
  prodHoldsThisRelease: boolean | null
}

/**
 * A type waiting for an agent is an activation, and so is the type this agent serves once it was
 * activated with this proposal (its done view). Otherwise an agent already in production is
 * promoted ("Pasar a producción"); one that never ran is activated.
 */
export function endStepFor(facts: EndStepFacts): EndStep {
  if (facts.typeAgent === 'ready') return 'activate'
  if (facts.servesThisAgent && facts.prodHoldsThisRelease !== false) return 'activate'
  return facts.inProduction ? 'promote' : 'activate'
}

/**
 * The stepper: Borrador, Lista para probar, Probada, Aprobada, Publicada, then Activa (`activate`)
 * or En producción (`promote`). `done` is true once that last step happened.
 */
export function proposalSteps(
  state: string,
  done: boolean,
  endStep: EndStep = 'activate',
): ProposalStep[] {
  const index = isProposalState(state) ? PROPOSAL_STATES.indexOf(state) : 0
  const keys: StepKey[] = [...PROPOSAL_STATES, 'active']
  const current = done ? keys.length : index
  return keys.map((key, position) => ({
    key,
    label:
      key === 'active' && endStep === 'promote'
        ? t('proposals.state.prod')
        : t(`proposals.state.${key}`),
    state: position < current ? 'done' : position === current ? 'current' : 'later',
  }))
}

/**
 * Who brought a proposal here: the platform's index (`platform`, `chat`, `tracked`, the
 * improvement engine's `engine`) or, for one only agent-core's list has, `registry`.
 */
export function proposalSource(source: string): {
  label: string
  engine: boolean
  registry: boolean
} {
  switch (source) {
    case 'platform':
    case 'chat':
    case 'tracked':
    case 'engine':
    case 'registry':
      return {
        label: t(`proposals.source.${source}`),
        engine: source === 'engine',
        registry: source === 'registry',
      }
    default:
      return { label: t('proposals.source.other'), engine: false, registry: false }
  }
}

const KINDS = [
  'agent',
  'flow',
  'prompt',
  'template',
  'tool',
  'policy',
  'decision_model',
  'eval_suite',
  'release_settings',
] as const
type KnownKind = (typeof KINDS)[number]

function isKnownKind(kind: string): kind is KnownKind {
  return (KINDS as readonly string[]).includes(kind)
}

export interface ChangeView {
  key: string
  /** "Flujo", "Instrucciones"… */
  kind: string
  /** The entity id ("t/resumen"); empty for release settings. */
  id: string
  /** "versión 1.1.0", or empty. */
  version: string
  description: string
  rationale: string
  changelog: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

/** One change of the draft, for reading (the content itself is configuration, not shown raw). */
export function changeView(change: EntityDraft, index: number): ChangeView {
  const id = text(change.content.id)
  const version = text(change.content.version)
  return {
    key: `${change.kind}:${id}:${index}`,
    kind: isKnownKind(change.kind) ? t(`proposal.kind.${change.kind}`) : t('proposal.kind.other'),
    id,
    version: version ? t('proposal.version', { version }) : '',
    description: change.docs.description,
    rationale: change.docs.rationale,
    changelog: change.docs.changelog,
  }
}

/** The agent entity of the draft (its `kind: agent` change for that agent), if any. */
function agentChange(changes: readonly EntityDraft[], agentId: string): EntityDraft | null {
  return changes.find((c) => c.kind === 'agent' && text(c.content.id) === agentId) ?? null
}

/** "Herramientas que usaría": the agent's `tools_allowed` in the draft ("leer_movimientos@1"). */
export function draftTools(changes: readonly EntityDraft[], agentId: string): string[] {
  const allowed = agentChange(changes, agentId)?.content.tools_allowed
  return Array.isArray(allowed) ? allowed.filter((x): x is string => typeof x === 'string') : []
}

/** A tool id in words: "registry/leer_movimientos@1" → "Leer movimientos". */
export function toolName(toolId: string): string {
  const base = toolId.split('@')[0]?.split('/').pop() ?? toolId
  const words = base.replace(/[-_]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : toolId
}

/** The agent's `supported_locales` in the draft as language marks (`es`, `pt`). */
export function draftLanguages(changes: readonly EntityDraft[], agentId: string): LanguageCode[] {
  const locales = agentChange(changes, agentId)?.content.supported_locales
  if (!Array.isArray(locales)) return []
  const codes = new Set<LanguageCode>()
  for (const locale of locales) {
    if (typeof locale !== 'string') continue
    if (locale.startsWith('es')) codes.add('es')
    if (locale.startsWith('pt')) codes.add('pt')
  }
  return [...codes]
}

export interface SuiteRef {
  suiteId: string
  suiteVersion: string | null
}

/**
 * The evaluation suite that tests the proposal: one the draft brings (`kind: eval_suite`), else
 * the one the base release was evaluated with. Null when there is none: agent-core cannot
 * evaluate, approve or publish it (slice 16 §8), and the screen says so without calling.
 */
export function suiteFor(
  changes: readonly EntityDraft[],
  baseRelease: ReleaseDetail | null | undefined,
): SuiteRef | null {
  const drafted = changes.find((c) => c.kind === 'eval_suite' && text(c.content.id))
  if (drafted) {
    return {
      suiteId: text(drafted.content.id),
      suiteVersion: text(drafted.content.version) || null,
    }
  }
  const ref = baseRelease?.evalSuiteRefs[0]
  return ref ? { suiteId: ref.id, suiteVersion: ref.version } : null
}

export interface ReportView {
  passed: boolean
  /** "3 de 4 criterios". */
  summary: string
  passedCount: number
  failedCount: number
  total: number
  /** What the gate decided, in words: it can be approved, it went back to draft, or no result. */
  decision: string
  decisionTone: 'success' | 'danger' | 'warn'
  /** Failed items first, then the passed ones, each in the report's order. */
  items: GateItemView[]
}

export interface GateItemView {
  key: string
  metric: string
  /** "Vara actual", "Vara nueva", "Plataforma". */
  phase: string
  passed: boolean
  /** "Cumple" / "No cumple". */
  verdict: string
  /** The base release's value ("Sin medir" when not measured). */
  base: string
  /** The proposal's value. */
  candidate: string
  /** The floor it must reach ("Sin mínimo" when there is none). */
  floor: string
  reason: string
}

const PHASES = ['base_yardstick', 'new_yardstick', 'platform'] as const

function phaseLabel(phase: string): string {
  return (PHASES as readonly string[]).includes(phase)
    ? t(`proposal.phase.${phase as (typeof PHASES)[number]}`)
    : t('proposal.phase.other')
}

function itemView(item: GateItem, index: number): GateItemView {
  return {
    key: `${item.metricId}:${item.phase}:${index}`,
    metric: item.metricId,
    phase: phaseLabel(item.phase),
    passed: item.passed,
    verdict: item.passed ? t('proposal.criterion.passed') : t('proposal.criterion.failed'),
    base: item.baseValue ?? t('proposal.criterion.notMeasured'),
    candidate: item.value ?? t('proposal.criterion.notMeasured'),
    floor: item.floor ?? t('proposal.criterion.noFloor'),
    reason: item.reason,
  }
}

/**
 * The test report, base against candidate item by item (never a composite score), the failed
 * items first, and what the gate decided.
 */
export function reportView(report: EvalReport): ReportView {
  const passedCount = report.items.filter((item) => item.passed).length
  const failedCount = report.items.length - passedCount
  const views = report.items.map(itemView)
  const decision =
    report.verdict === 'pass'
      ? { decision: t('proposal.gate.pass'), decisionTone: 'success' as const }
      : report.verdict === 'fail'
        ? {
            decision: t('proposal.gate.fail', { count: failedCount }),
            decisionTone: 'danger' as const,
          }
        : { decision: t('proposal.gate.infra'), decisionTone: 'warn' as const }
  return {
    passed: report.verdict === 'pass',
    summary: t('proposal.criteria', { passed: passedCount, total: report.items.length }),
    passedCount,
    failedCount,
    total: report.items.length,
    ...decision,
    items: [...views.filter((v) => !v.passed), ...views.filter((v) => v.passed)],
  }
}

/** agent-core's closed list of rejection reasons (its PR 53), in the order the dialog offers. */
export const REASON_CODES: readonly ReasonCode[] = [
  'insufficient_evidence',
  'wrong_target',
  'risk',
  'duplicate',
  'policy_conflict',
  'wording',
  'other',
]

export function isReasonCode(value: string): value is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(value)
}

/** A rejection reason in words ("Falta evidencia"). */
export function reasonCodeLabel(code: ReasonCode): string {
  return t(`reasonCode.${code}`)
}

export type HistoryIcon =
  | 'created'
  | 'engine'
  | 'frozen'
  | 'passed'
  | 'failed'
  | 'approved'
  | 'rejected'
  | 'reopened'
  | 'published'
  | 'prod'

export interface HistoryItemView {
  key: string
  icon: HistoryIcon
  /** "Lucía Gómez la aprobó", "El motor de mejora la anunció". */
  text: string
  /** A short tag: the rejection reason, or the criteria of an evaluation. */
  tag: string | null
  tagTone: 'neutral' | 'success' | 'danger' | 'warn'
  /** The release it published or promoted (shown as an id). */
  releaseId: string | null
  /** When (ISO): the screen formats it. */
  at: string
}

function who(entry: ProposalHistoryEntry): string {
  return entry.actorName ?? t('history.someone')
}

function historyText(entry: ProposalHistoryEntry): { icon: HistoryIcon; text: string } {
  const name = who(entry)
  switch (entry.kind) {
    case 'created':
      return { icon: 'created', text: t('history.created', { name }) }
    case 'tracked':
      if (entry.source === 'engine') return { icon: 'engine', text: t('history.engine') }
      if (entry.source === 'chat') return { icon: 'created', text: t('history.chat', { name }) }
      return { icon: 'created', text: t('history.tracked', { name }) }
    case 'frozen':
      return { icon: 'frozen', text: t('history.frozen', { name }) }
    case 'evaluated':
      if (entry.verdict === 'pass') return { icon: 'passed', text: t('history.passed', { name }) }
      if (entry.verdict === 'fail') return { icon: 'failed', text: t('history.failed', { name }) }
      return { icon: 'failed', text: t('history.infra', { name }) }
    case 'approved':
      return { icon: 'approved', text: t('history.approved', { name }) }
    case 'rejected':
      return { icon: 'rejected', text: t('history.rejected', { name }) }
    case 'reopened':
      return { icon: 'reopened', text: t('history.reopened', { name }) }
    case 'published':
      return { icon: 'published', text: t('history.published', { name }) }
    case 'promoted':
      return entry.alias === 'prod'
        ? { icon: 'prod', text: t('history.prod', { name }) }
        : { icon: 'published', text: t('history.staging', { name }) }
  }
}

function historyTag(entry: ProposalHistoryEntry): Pick<HistoryItemView, 'tag' | 'tagTone'> {
  if (entry.kind === 'rejected' && entry.reasonCode) {
    return { tag: reasonCodeLabel(entry.reasonCode), tagTone: 'neutral' }
  }
  if (entry.kind === 'evaluated' && entry.items !== null && entry.verdict !== 'failed_infra') {
    const total = entry.items
    const passed = total - (entry.itemsFailed ?? 0)
    return {
      tag: t('proposal.criteria', { passed, total }),
      tagTone: entry.verdict === 'pass' ? 'success' : 'danger',
    }
  }
  return { tag: null, tagTone: 'neutral' }
}

/**
 * The verdict story, oldest first: how it got here, each test and its result, the decisions
 * (with agent-core's rejection reason) and the way to production. From the platform's audit.
 */
export function historyView(entries: readonly ProposalHistoryEntry[]): HistoryItemView[] {
  return entries.map((entry, index) => ({
    key: `${entry.kind}:${entry.at}:${index}`,
    ...historyText(entry),
    ...historyTag(entry),
    releaseId: entry.kind === 'published' || entry.kind === 'promoted' ? entry.releaseId : null,
    at: entry.at,
  }))
}

/** The release this proposal published last (from its history), or null. */
export function publishedReleaseOf(entries: readonly ProposalHistoryEntry[]): string | null {
  const published = entries.filter((e) => e.kind === 'published' && e.releaseId)
  return published.at(-1)?.releaseId ?? null
}

/** Whether the improvement engine brought it here (its history says so). */
export function announcedByEngine(entries: readonly ProposalHistoryEntry[]): boolean {
  return entries.some((e) => e.kind === 'tracked' && e.source === 'engine')
}

/** The agent's version inside a release (`kind: agent`, the release's agent), or null. */
export function agentVersionIn(release: ReleaseDetail | null | undefined): string | null {
  const entry = release?.entities.find(
    (e) => e.ref.kind === 'agent' && e.ref.id === release.agentId,
  )
  return entry?.ref.version ?? null
}

/** A publication's idempotency key: one per dialog (kept for its retries). */
export function newIdempotencyKey(): string {
  return `publish-${crypto.randomUUID()}`
}

export type BuilderFailure =
  | { kind: 'stepUp'; message: string }
  | { kind: 'locked'; message: string }
  | { kind: 'noSuite' }
  | { kind: 'gateFailed'; report: EvalReport | null }
  | { kind: 'loosening'; changes: YardstickChange[] }
  | { kind: 'violations'; violations: Violation[] }
  | { kind: 'conflict'; message: string }
  | { kind: 'notReady'; message: string }
  | { kind: 'message'; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asReport(value: unknown): EvalReport | null {
  return isRecord(value) && Array.isArray(value.items) ? (value as unknown as EvalReport) : null
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * Every failure of the builder, the step-up and the activation, in words or as the structure the
 * screen shows (a failed gate is a result, not an error; slice 16 §5).
 */
export function describeBuilderFailure(error: unknown): BuilderFailure {
  if (!isApiProblem(error)) return { kind: 'message', message: t('failure.generic') }
  switch (error.code) {
    case 'builder_step_up_invalid': {
      const remaining = error.numberExtension('remainingAttempts')
      return {
        kind: 'stepUp',
        message:
          remaining === null ? t('stepUp.wrongUnknown') : t('stepUp.wrong', { count: remaining }),
      }
    }
    case 'account_locked':
      return { kind: 'locked', message: t('stepUp.locked') }
    case 'registry_gate_failed':
      return { kind: 'gateFailed', report: asReport(error.extensions.report) }
    case 'registry_loosening_not_accepted':
      return {
        kind: 'loosening',
        changes: asList<YardstickChange>(error.extensions.yardstickLoosened),
      }
    case 'registry_validation_failed':
      return { kind: 'violations', violations: asList<Violation>(error.extensions.violations) }
    case 'registry_not_found':
      return { kind: 'message', message: t('failure.notFound') }
    case 'registry_conflict':
    case 'conflict':
      return { kind: 'conflict', message: t('failure.conflict') }
    case 'invalid_transition':
      return { kind: 'notReady', message: t('activate.notReady') }
    case 'registry_forbidden':
    case 'forbidden':
      return { kind: 'message', message: t('failure.forbidden') }
    case 'registry_quota_exceeded':
      return { kind: 'message', message: t('failure.quota') }
    case 'agent_core_unavailable':
    case 'agent_core_rejected':
    case 'assistant_disabled':
    case 'network_error':
      return { kind: 'message', message: t('failure.unavailable') }
    default:
      return { kind: 'message', message: t('failure.generic') }
  }
}

/** Whether an evaluation failure means the agent has no suite (404 on evaluate). */
export function isMissingSuite(error: unknown): boolean {
  return isApiProblem(error, 'registry_not_found')
}
