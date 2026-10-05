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
  ProposalState,
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
 * The stepper: Borrador, Lista para probar, Probada, Aprobada, Publicada, Activa. `active` is
 * true once the agent serves the type (the last step done).
 */
export function proposalSteps(state: string, active: boolean): ProposalStep[] {
  const index = isProposalState(state) ? PROPOSAL_STATES.indexOf(state) : 0
  const keys: StepKey[] = [...PROPOSAL_STATES, 'active']
  const current = active ? keys.length : index
  return keys.map((key, position) => ({
    key,
    label: t(`proposals.state.${key}`),
    state: position < current ? 'done' : position === current ? 'current' : 'later',
  }))
}

/** Where a proposal came from. Ready for the improvement engine's `engine` (PR #17). */
export function proposalSource(source: string): { label: string; engine: boolean } {
  switch (source) {
    case 'platform':
    case 'chat':
    case 'tracked':
    case 'engine':
      return { label: t(`proposals.source.${source}`), engine: source === 'engine' }
    default:
      return { label: t('proposals.source.other'), engine: false }
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
  total: number
  items: GateItemView[]
}

export interface GateItemView {
  key: string
  metric: string
  passed: boolean
  /** "Cumple" / "No cumple". */
  verdict: string
  /** "Valor 0.92", "Mínimo 0.85", "Antes 0.90": each its own fact. */
  facts: string[]
  reason: string
}

function itemView(item: GateItem, index: number): GateItemView {
  const facts: (string | null)[] = [
    item.value !== null ? t('proposal.criterion.value', { value: item.value }) : null,
    item.floor !== null ? t('proposal.criterion.floor', { floor: item.floor }) : null,
    item.baseValue !== null ? t('proposal.criterion.base', { value: item.baseValue }) : null,
  ]
  return {
    key: `${item.metricId}:${item.phase}:${index}`,
    metric: item.metricId,
    passed: item.passed,
    verdict: item.passed ? t('proposal.criterion.passed') : t('proposal.criterion.failed'),
    facts: facts.filter((fact): fact is string => fact !== null),
    reason: item.reason,
  }
}

/** The test report, each gate item apart (never a composite score). */
export function reportView(report: EvalReport): ReportView {
  const passedCount = report.items.filter((item) => item.passed).length
  return {
    passed: report.verdict === 'pass',
    summary: t('proposal.criteria', { passed: passedCount, total: report.items.length }),
    passedCount,
    total: report.items.length,
    items: report.items.map(itemView),
  }
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
