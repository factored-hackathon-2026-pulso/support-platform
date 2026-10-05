/**
 * The assistant's handoff ("Traspaso", slice 19; contract slice-14-assistant.md §4.1): agent-core's
 * `HandoffPacket` as the platform passes it through (snake_case, untyped) → what the analyst
 * reads. It is read defensively: a missing or oddly shaped member becomes an empty section,
 * never a crash. agent-core's own words (fact names, the summary) are shown as they come; its
 * codes (the reason, action states, fact sources, the priority) get words from the catalog here.
 *
 * The compact card leads with why it was handed over, the priority the assistant saw, the
 * suggested queue and what it verified: agent-core's `request_summary.text` is often generic
 * ("Una política exigió atención humana…"), so it goes last, as "Qué pide".
 *
 * Also the close dialog's "¿Te sirvió el traspaso?" options (`handoffQuality`). Pure,
 * unit-tested in handoff.test.ts.
 */
import { isApiProblem } from '@/lib/api'
import { i18n } from '@/lib/i18n'
import type catalog from '@/locales/es/conversation'
import type { CasePriority, HandoffQuality } from './types'

/** Copy comes from the `conversation` catalog, read when a function runs (the UI language then). */
const t = i18n.getFixedT(null, 'conversation')

type HandoffCatalog = (typeof catalog)['handoff']

/** Whether `value` is one of the keys of a catalog block (agent-core's codes we have words for). */
function isKeyOf<T extends object>(block: T, value: string): value is Extract<keyof T, string> {
  return Object.hasOwn(block, value)
}

/** One line of a section: the main text and an optional muted detail. */
export interface HandoffItem {
  key: string
  text: string
  detail: string | null
  /** A nested value (a list, an object) as readable lines under the text, one per item. */
  lines?: readonly string[]
}

export interface HandoffView {
  /** "Posible fraude: una política pide una persona" (the humanized `reason_code`). */
  reason: string
  /** A second, more specific line under the reason (the policy or rule name), if any. */
  reasonDetail: string | null
  /** The priority the assistant saw (`normal` reads as medium); null when unknown. */
  priority: Exclude<CasePriority, 'none'> | null
  /** The queue the assistant suggested ("Disputas"); null when absent. */
  queue: string | null
  /** `request_summary.text`: "Qué pide", in the assistant's words. */
  summary: string | null
  verified: HandoffItem[]
  claimed: HandoffItem[]
  actions: HandoffItem[]
  open: HandoffItem[]
  /** agent-core could only build part of the packet (`degraded_packet`). */
  degraded: boolean
}

type Json = Record<string, unknown>

const asRecord = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

/** "card_blocked" / "robo-tarjeta" → "Card blocked" / "Robo tarjeta" (agent-core's own words). */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/@.*$/, '')
    .replace(/[_\-/.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

/** A fact's or slot's value as one short line ("120", "Sí", `{"a":1}` cut at 120 characters). */
export function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? t('handoff.yes') : t('handoff.no')
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.trim() || null
  const json = JSON.stringify(value)
  return json.length > 120 ? `${json.slice(0, 119)}…` : json
}

/** At most this many lines of a nested value (then "y N más"). */
export const MAX_VALUE_LINES = 8
const MAX_LINE = 160

const clip = (text: string) => (text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text)

/** A value inside a line: scalars as words, a list joined with commas, an object as pairs. */
function inlineValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const parts = value.map(inlineValue).filter((part): part is string => part !== null)
    return parts.length ? parts.join(', ') : null
  }
  const record = asRecord(value)
  if (record) {
    const pairs = Object.entries(record).flatMap(([key, inner]) => {
      const text = inlineValue(inner)
      return text ? [`${humanizeKey(key)}: ${text}`] : []
    })
    return pairs.length ? pairs.join(', ') : null
  }
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? t('handoff.yes') : t('handoff.no')
  if (typeof value === 'number') return String(value)
  return typeof value === 'string' ? value.trim() || null : null
}

/**
 * A nested fact value as readable lines (keys humanized, one line per item): a list gives one
 * line per element (`Transaction id: TX-1, Amount: 120`), an object one per key (`Amount: 120`).
 * `null` for a scalar (it stays on the fact's own line). Long lists end with "y N más".
 */
export function valueLines(value: unknown): string[] | null {
  let lines: string[]
  if (Array.isArray(value)) {
    lines = value.map(inlineValue).filter((line): line is string => line !== null)
  } else {
    const record = asRecord(value)
    if (!record) return null
    lines = Object.entries(record).flatMap(([key, inner]) => {
      const text = inlineValue(inner)
      return text ? [`${humanizeKey(key)}: ${text}`] : []
    })
  }
  const shown = lines.slice(0, MAX_VALUE_LINES).map(clip)
  const rest = lines.length - shown.length
  return rest > 0 ? [...shown, t('handoff.more', { count: rest })] : shown
}

/** `reason_code` → a sentence and, for `policy:` / `rule:` / `interrupt:` codes, their name. */
export function handoffReason(code: string | null): { reason: string; detail: string | null } {
  if (!code) return { reason: t('handoff.reason.none'), detail: null }
  // agent-core's reason codes → why the analyst has the case.
  if (isKeyOf(REASON_CODES, code)) return { reason: t(`handoff.reasons.${code}`), detail: null }
  const [prefix, name = ''] = code.split(/:(.*)/s)
  const detail = name ? humanizeKey(name) : null
  switch (prefix) {
    case 'policy':
      return { reason: t('handoff.reason.policy'), detail }
    case 'rule':
      return { reason: t('handoff.reason.rule'), detail }
    // agent-core interrupts the flow on a situation only a person may handle ("interrupt:fraude").
    case 'interrupt':
      return { reason: t('handoff.reason.interrupt'), detail }
    default:
      return { reason: humanizeKey(code), detail: null }
  }
}

const PRIORITIES: Record<string, Exclude<CasePriority, 'none'>> = {
  low: 'low',
  normal: 'medium', // agent-core's default when a flow sets none (the backend maps it the same)
  medium: 'medium',
  high: 'high',
  critical: 'critical',
}

/**
 * agent-core's codes the catalog has words for: reason codes (`ReasonCode`), fact sources
 * (`source.kind`) and action states (`ActionState`). Only the codes live here; the words are
 * read from `conversation:handoff.*` when shown.
 */
const REASON_CODES: Record<keyof HandoffCatalog['reasons'], true> = {
  low_confidence: true,
  budget_exceeded: true,
  tool_failure: true,
  customer_request: true,
  verification_failed: true,
  validation_failed: true,
  release_revoked: true,
  auth_insufficient: true,
}
const FACT_SOURCES: Record<keyof HandoffCatalog['sources'], true> = {
  tool: true,
  compute: true,
  identity: true,
  knowledge: true,
  agent: true,
}
const ACTION_STATES: Record<keyof HandoffCatalog['actionStates'], true> = {
  proposed: true,
  confirmed: true,
  executing: true,
  executed: true,
  uncertain: true,
  denied: true,
  verified: true,
  failed: true,
  cancelled: true,
}

/** A fact's source → where it came from ("De una consulta"), or null. */
function factSource(kind: string): string | null {
  return isKeyOf(FACT_SOURCES, kind) ? t(`handoff.sources.${kind}`) : null
}

/** An action state → a word ("Hecha", "Falló"); an unknown state, humanized. */
function actionState(state: string): string {
  return isKeyOf(ACTION_STATES, state) ? t(`handoff.actionStates.${state}`) : humanizeKey(state)
}

/** A tool reference: `"radicar_pqr@1.0.0"` or `{ id, version }` → "Radicar pqr". */
function toolName(tool: unknown): string {
  const text = asText(tool) ?? asText(asRecord(tool)?.id)
  return text ? humanizeKey(text) : t('handoff.someAction')
}

/** A named fact or claim: "Monto: 120", or the name with its nested value as lines. */
function namedValue(entry: Json): { text: string; lines?: string[] } | null {
  const name = asText(entry.name)
  if (!name) return null
  const lines = valueLines(entry.value)
  if (lines !== null) return lines.length ? { text: humanizeKey(name), lines } : null
  const value = formatValue(entry.value)
  return { text: value ? `${humanizeKey(name)}: ${value}` : humanizeKey(name) }
}

/** The packet → the analyst's view. Anything unreadable is left out. */
export function readHandoff(packet: Json): HandoffView {
  const { reason, detail } = handoffReason(asText(packet.reason_code))
  const priority = PRIORITIES[(asText(packet.priority) ?? '').toLowerCase()] ?? null
  const queue = asText(packet.target_queue)
  const verified = asList(packet.verified_facts).flatMap((raw, index): HandoffItem[] => {
    const entry = asRecord(raw)
    const named = entry ? namedValue(entry) : null
    if (!entry || !named) return []
    const kind = asText(asRecord(entry.source)?.kind)
    return [
      {
        key: asText(entry.fact_id) ?? `fact-${index}`,
        ...named,
        detail: kind ? factSource(kind) : null,
      },
    ]
  })
  const claimed = asList(packet.claimed_not_verified).flatMap((raw, index): HandoffItem[] => {
    const entry = asRecord(raw)
    const named = entry ? namedValue(entry) : null
    return entry && named ? [{ key: `claim-${index}`, ...named, detail: null }] : []
  })
  const actions = asList(packet.actions_taken).flatMap((raw, index): HandoffItem[] => {
    const entry = asRecord(raw)
    if (!entry) return []
    const state = asText(entry.state)
    return [
      {
        key: asText(entry.action_id) ?? `action-${index}`,
        text: toolName(entry.tool),
        detail: state ? actionState(state) : null,
      },
    ]
  })
  const open = asList(packet.open_questions).flatMap((raw, index): HandoffItem[] => {
    const text = asText(raw)
    return text ? [{ key: `open-${index}`, text, detail: null }] : []
  })
  return {
    reason,
    reasonDetail: detail,
    priority,
    queue: queue ? humanizeKey(queue) : null,
    summary: asText(asRecord(packet.request_summary)?.text),
    verified,
    claimed,
    actions,
    open,
    degraded: packet.degraded_packet === true,
  }
}

/** "2 datos verificados" / "1 dato verificado" / "Nada verificado" (the compact card). */
export function verifiedCountLabel(count: number): string {
  if (count === 0) return t('handoff.nothingVerified')
  return t('handoff.verifiedCount', { count })
}

/** The handoff could not be read: a retry for an agent-core outage, nothing for the rest. */
export interface HandoffFailure {
  title: string
  description: string
  retry: boolean
}

export function describeHandoffFailure(error: unknown): HandoffFailure {
  if (isApiProblem(error, 'agent_core_unavailable') || isApiProblem(error, 'agent_core_rejected')) {
    return {
      title: t('handoff.failure.title'),
      description: t('handoff.failure.unavailableText'),
      retry: true,
    }
  }
  if (isApiProblem(error, 'network_error')) {
    return {
      title: t('handoff.failure.title'),
      description: t('handoff.failure.networkText'),
      retry: true,
    }
  }
  return {
    title: t('handoff.failure.missingTitle'),
    description: t('handoff.failure.missingText'),
    retry: false,
  }
}

/** Whether the case came to her from an assistant escalation (the handoff can be read). */
export function hasHandoff(
  detail: {
    assignment: { reason: string; analystId: string } | null
  },
  meId: string,
): boolean {
  return detail.assignment?.reason === 'assistant_handoff' && detail.assignment.analystId === meId
}

// ── "¿Te sirvió el traspaso?" (close dialog) ─────────────────────────────────

export interface HandoffQualityOption {
  value: HandoffQuality
  /** In the UI language (read from `conversation:handoff.quality.<value>` when shown). */
  readonly label: string
  readonly description: string
  icon: 'thumbs-up' | 'puzzle' | 'circle-minus'
  tone: 'success' | 'warn' | 'neutral'
}

/** An option whose words are getters over the catalog. */
function qualityOption(
  option: Omit<HandoffQualityOption, 'label' | 'description'>,
): HandoffQualityOption {
  return {
    ...option,
    get label() {
      return t(`handoff.quality.${option.value}.label`)
    },
    get description() {
      return t(`handoff.quality.${option.value}.description`)
    },
  }
}

export const HANDOFF_QUALITY_OPTIONS: readonly HandoffQualityOption[] = [
  qualityOption({ value: 'useful', icon: 'thumbs-up', tone: 'success' }),
  qualityOption({ value: 'incomplete', icon: 'puzzle', tone: 'warn' }),
  qualityOption({ value: 'unnecessary', icon: 'circle-minus', tone: 'neutral' }),
]

/** Picking the selected option again clears it (the label is optional). */
export function toggleHandoffQuality(
  current: HandoffQuality | null,
  picked: HandoffQuality,
): HandoffQuality | null {
  return current === picked ? null : picked
}
