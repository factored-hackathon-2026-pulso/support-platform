/**
 * Pure rules of the AI stages per case type (slice 21, docs/platform/api/slice-21-stages.md): a
 * case's copilot mode is its type's stage, and the stage strip under the case header says where
 * the type is. No React, no I/O: unit-tested in stages.test.ts.
 */
import type { Schemas } from '@/lib/api'
import { i18n } from '@/lib/i18n'
import type { CopilotMode } from './model'

const t = i18n.getFixedT(null, 'copilot')

export type AiStages = Schemas['AiStages']
export type CaseTypeStage = Schemas['CaseTypeStage']
type CaseType = Schemas['CaseType']

/** The catalog key of each stage, 0 to 3 (`copilot:stage.text.*`). */
const STAGE_KEYS = ['team', 'answers', 'tools', 'drafts'] as const

/** What the copilot does for a type at a stage (IaWorkspace's stage line); '' for an unknown one. */
export function stageText(stage: number): string {
  const key = STAGE_KEYS[stage]
  return key ? t(`stage.text.${key}`) : ''
}

/** The stage of a case's type, or null: AI off, the stages unknown yet, or no type. */
export function stageOfType(
  stages: AiStages | undefined,
  caseType: CaseType | undefined,
): CaseTypeStage | null {
  if (!stages?.available || !caseType || caseType === 'none') return null
  return stages.types.find((entry) => entry.caseType === caseType) ?? null
}

/**
 * How far the copilot goes for a case: its type's stage (stage 0 and "Sin tipo": no copilot).
 * Unknown stages read as no copilot, so nothing flashes before they arrive.
 */
export function copilotModeOf(
  stages: AiStages | undefined,
  caseType: CaseType | undefined,
): CopilotMode | null {
  return stageOfType(stages, caseType)?.copilotMode ?? null
}

export interface StageStripView {
  /** The three bars: filled up to the stage (all of them for a type an agent serves). */
  bars: readonly [boolean, boolean, boolean]
  /** An agent serves the type (the bot glyph). */
  agent: boolean
  /** The one quiet line. */
  line: string
}

export function stageStrip(stage: CaseTypeStage): StageStripView {
  const agent = stage.agent === 'active'
  const filled = (k: number) => agent || stage.stage >= k
  return {
    bars: [filled(1), filled(2), filled(3)],
    agent,
    line: agent
      ? t('stage.agent')
      : t('stage.line', { stage: stage.stage, text: stageText(stage.stage) }),
  }
}
