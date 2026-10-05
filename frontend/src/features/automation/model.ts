/**
 * Pure rules of the case types' panorama and of one type (slice 22, IaAutomatizacion views
 * `panorama` and `tipo`): the stage in words, the signal of the current stage, how the type
 * matured, the team rule's thresholds against today's signals, the drafts breakdown, the stages it
 * can move back to and the agent the system proposes. No React, no I/O: model.test.ts.
 */
import { caseType } from '@/features/cases/core'
import { formatDate } from '@/lib/format'
import { i18n } from '@/lib/i18n'
import type { AiStages, CaseType, CaseTypeStage, MaturingType, StageRule } from './types'

const t = i18n.getFixedT(null, 'automation')

/** The catalog key of what a stage does, 0 to 3 (`automation:stage.tip.*`). */
const STAGE_KEYS = ['people', 'answers', 'tools', 'drafts'] as const
type StageKey = (typeof STAGE_KEYS)[number]

function stageKey(stage: number): StageKey {
  return STAGE_KEYS[Math.max(0, Math.min(3, stage))] ?? 'people'
}

/** The types in the panorama's order: the ones closest to an agent first, then by stage. */
export function panoramaTypes(stages: AiStages | undefined): CaseTypeStage[] {
  if (!stages?.available) return []
  const weight = (entry: CaseTypeStage) =>
    entry.agent === 'ready' ? 5 : entry.agent === 'active' ? 4 : entry.stage
  return [...stages.types].sort((a, b) => weight(b) - weight(a))
}

/** The type the URL names (`?type=`), or null when unknown or not in the stages. */
export function typeStage(
  stages: AiStages | undefined,
  type: string | null | undefined,
): CaseTypeStage | null {
  if (!stages?.available || !type) return null
  return stages.types.find((entry) => entry.caseType === type) ?? null
}

/** The type in words ("Cobro indebido"), from the cases vocabulary. */
export function typeName(type: MaturingType): string {
  return caseType(type).label
}

/** Its dataset category ("Comisiones"; "Producto nuevo (ejemplo)" for the team's own type). */
export function typeCategory(type: MaturingType): string {
  return t(`category.${type}`)
}

export interface StageView {
  /** "Etapa 2" or "Con agente". */
  label: string
  /** What the copilot does there ("El copiloto propone herramientas"). */
  tip: string
  /** The three bars: filled up to the stage (all of them with an agent). */
  bars: readonly [boolean, boolean, boolean]
  /** An agent serves the type (the bot glyph). */
  agent: boolean
  /** The system proposes an agent for it. */
  ready: boolean
}

export function stageView(entry: CaseTypeStage): StageView {
  const agent = entry.agent === 'active'
  const filled = (k: number) => agent || entry.stage >= k
  return {
    label: agent ? t('stage.agent') : t('stage.label', { stage: entry.stage }),
    tip: agent ? t('stage.tip.agent') : t(`stage.tip.${stageKey(entry.stage)}`),
    bars: [filled(1), filled(2), filled(3)],
    agent,
    ready: entry.agent === 'ready',
  }
}

/** The legend of the panorama: one entry per stage and "Con agente". */
export function stageLegend(): { key: string; label: string; bars: readonly boolean[] }[] {
  return [
    { key: 'people', label: t('stage.legend.people'), bars: [false, false, false] },
    { key: 'answers', label: t('stage.legend.answers'), bars: [true, false, false] },
    { key: 'tools', label: t('stage.legend.tools'), bars: [true, true, false] },
    { key: 'drafts', label: t('stage.legend.drafts'), bars: [true, true, true] },
    { key: 'agent', label: t('stage.legend.agent'), bars: [true, true, true] },
  ]
}

/** "Lo que mide ahora": the signal the current stage is measured by (IaAutomatizacion). */
export function signalLine(entry: CaseTypeStage, rule: StageRule): string {
  const s = entry.signals
  if (entry.agent === 'active') {
    return entry.agentId
      ? t('signal.agent', { agent: agentName(entry.agentId) })
      : t('signal.agentUnnamed')
  }
  switch (entry.stage) {
    case 0:
      return t('signal.people', { resolved: s.resolvedCases, target: rule.resolvedCasesToAsk })
    case 1:
      return s.closedCases === 0
        ? t('signal.empty')
        : t('signal.answers', { asked: s.askedCases, closed: s.closedCases })
    case 2:
      return s.toolCases === 0
        ? t('signal.empty')
        : t('signal.tools', { used: s.toolUsedCases, cases: s.toolCases })
    default:
      return s.drafts === 0
        ? t('signal.empty')
        : t('signal.drafts', { asIs: s.draftsAsIs, drafts: s.drafts })
  }
}

export type StepState = 'done' | 'later'

export interface MaturityStep {
  key: 'answers' | 'tools' | 'drafts' | 'agent'
  /** "1", "2", "3"; null for the agent (a check). */
  number: string | null
  title: string
  /** "Desde el 4 ago 2026", "Propuesto el …", "Activo desde el …" or "Todavía no". */
  when: string
  state: StepState
}

/** "Cómo maduró": the stages it reached and since when, then the agent. */
export function maturitySteps(entry: CaseTypeStage): MaturityStep[] {
  const since = new Map(entry.reached.map((r) => [r.stage, r.since]))
  const steps: MaturityStep[] = (['answers', 'tools', 'drafts'] as const).map((key, index) => {
    const stage = index + 1
    const at = since.get(stage)
    const done = entry.stage >= stage || entry.agent !== 'none'
    return {
      key,
      number: String(stage),
      title: t(`type.steps.${key}`),
      when: done && at ? t('type.since', { date: formatDate(at) }) : t('type.notYet'),
      state: done ? 'done' : 'later',
    }
  })
  const agentAt = entry.agentSince ? formatDate(entry.agentSince) : null
  steps.push({
    key: 'agent',
    number: null,
    title: t('type.steps.agent'),
    when:
      entry.agent === 'active' && agentAt
        ? t('type.activeSince', { date: agentAt })
        : entry.agent === 'ready' && agentAt
          ? t('type.proposedOn', { date: agentAt })
          : t('type.notYet'),
    state: entry.agent === 'none' ? 'later' : 'done',
  })
  return steps
}

export type RuleState = 'met' | 'current' | 'later'

export interface RuleLine {
  key: StageKey
  /** "Etapa 2 a 3". */
  step: string
  /** The threshold in words, from the team rule. */
  rule: string
  /** "Cumplida", "Hoy: 6 de 10 casos" or "Todavía no". */
  now: string
  state: RuleState
}

/** "Umbrales para pasar de etapa": each step of the team rule against today's signals. */
export function ruleLines(entry: CaseTypeStage, rule: StageRule): RuleLine[] {
  const s = entry.signals
  const reachedAgent = entry.agent !== 'none'
  const current: Record<StageKey, string> = {
    people: t('type.rule.value.people', {
      count: s.resolvedCases,
      target: rule.resolvedCasesToAsk,
    }),
    answers: t('type.rule.value.answers', {
      count: s.askedCases,
      target: rule.askedCasesToProposeTools,
    }),
    tools: t('type.rule.value.tools', { used: s.toolUsedCases, cases: s.toolCases }),
    drafts: t('type.rule.value.drafts', { asIs: s.draftsAsIs, drafts: s.drafts }),
  }
  const text: Record<StageKey, string> = {
    people: t('type.rule.people', { count: rule.resolvedCasesToAsk }),
    answers: t('type.rule.answers', { count: rule.askedCasesToProposeTools }),
    tools: t('type.rule.tools', {
      percent: rule.toolUsePercentToShadow,
      minimum: rule.toolCasesMinimum,
    }),
    drafts: t('type.rule.drafts', {
      percent: rule.draftAsIsPercentForAgent,
      window: rule.draftWindow,
    }),
  }
  return STAGE_KEYS.map((key, index) => {
    const met = index < entry.stage || (index === 3 && reachedAgent)
    const state: RuleState = met ? 'met' : index === entry.stage ? 'current' : 'later'
    return {
      key,
      step: t(`type.rule.step.${key}`),
      rule: text[key],
      now:
        state === 'met'
          ? t('type.rule.met')
          : state === 'current'
            ? t('type.rule.now', { value: current[key] })
            : t('type.rule.later'),
      state,
    }
  })
}

export interface DraftBreakdown {
  total: number
  asIs: number
  edited: number
  discarded: number
}

/** The drafts of the window (stage 3 and beyond): null before stage 3 or with none decided. */
export function draftBreakdown(entry: CaseTypeStage): DraftBreakdown | null {
  const s = entry.signals
  if (entry.stage < 3 || s.drafts === 0) return null
  return {
    total: s.drafts,
    asIs: s.draftsAsIs,
    edited: s.draftsEdited,
    discarded: s.draftsDiscarded,
  }
}

/** The last change in words ("Lo devolvió Lucía Herrera"), or null. */
export function lastChangeLine(entry: CaseTypeStage): string | null {
  const change = entry.lastChange
  if (!change) return null
  switch (change.kind) {
    case 'moved_back':
      return change.byName
        ? t('type.lastChange.moved_back', { name: change.byName })
        : t('type.lastChange.movedBackUnnamed')
    case 'agent_active':
      return change.byName
        ? t('type.lastChange.agent_active', { name: change.byName })
        : t('type.lastChange.agentActiveUnnamed')
    case 'advanced':
      return t('type.lastChange.advanced')
    case 'agent_ready':
      return t('type.lastChange.agent_ready')
    default:
      return null
  }
}

export interface MoveBackOption {
  value: number
  label: string
}

/**
 * The stages a type can go back to: every stage below its own, and, for a type ready for an agent,
 * stage 3 itself (it withdraws the proposal). None while an agent serves it.
 */
export function moveBackOptions(entry: CaseTypeStage): MoveBackOption[] {
  if (entry.agent === 'active') return []
  const options: MoveBackOption[] = []
  if (entry.agent === 'ready') options.push({ value: 3, label: t('moveBack.withdraw') })
  for (let stage = entry.stage - 1; stage >= 0; stage -= 1) {
    options.push({
      value: stage,
      label: t('moveBack.option', {
        stage,
        text: t(`stage.tip.${stageKey(stage)}`).toLowerCase(),
      }),
    })
  }
  return options
}

/** The toast after moving back. */
export function moveBackResult(
  type: MaturingType,
  toStage: number,
  changed: boolean,
  withdrew: boolean,
): string {
  const name = typeName(type)
  if (!changed) return t('moveBack.unchanged', { type: name })
  return withdrew
    ? t('moveBack.withdrawn', { type: name })
    : t('moveBack.done', { type: name, stage: toStage })
}

/**
 * The agent a type's proposals are for. The type's own once an agent serves it; otherwise a
 * suggested id. agent-core's registry has no agent catalog (slice 16 §8): `disputas` is its demo
 * agent for card disputes ("Cargo no reconocido", the seed's story); the other ids are
 * team-generated suggestions the builder chat can create.
 */
const SUGGESTED_AGENT: Record<MaturingType, string> = {
  unrecognized_charge: 'disputas',
  undue_charge: 'cobros',
  app_issue: 'soporte-app',
  branch_service: 'sucursales',
  service_quality: 'calidad-servicio',
  virtual_card: 'tarjeta-virtual',
}

export function agentIdFor(entry: CaseTypeStage): string {
  if (entry.agentId) return entry.agentId
  return isMaturing(entry.caseType) ? SUGGESTED_AGENT[entry.caseType] : ''
}

/** Every type but "Sin tipo" matures (the API never lists `none` among the stages). */
export function isMaturing(type: CaseType): type is MaturingType {
  return type !== 'none'
}

/**
 * An agent's id in words: "disputas" → "Disputas", "calidad-servicio" → "Calidad servicio".
 * Ids are agent-core data (no display name in the registry).
 */
export function agentName(agentId: string): string {
  const words = agentId.replace(/[-_/]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : agentId
}

/** Types waiting for an agent (`ready`): what "Activar" can serve. */
export function readyTypes(stages: AiStages | undefined): CaseTypeStage[] {
  if (!stages?.available) return []
  return stages.types.filter((entry) => entry.agent === 'ready')
}
