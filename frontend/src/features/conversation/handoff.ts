/**
 * The assistant's handoff ("Traspaso", slice 19; contract slice-14-assistant.md §4.1): agent-core's
 * `HandoffPacket` as the platform passes it through (snake_case, untyped) → what the analyst
 * reads. It is read defensively: a missing or oddly shaped member becomes an empty section,
 * never a crash. agent-core's own words (fact names, the summary) are shown as they come; its
 * codes (the reason, action states, fact sources, the priority) get Spanish words here.
 *
 * The compact card leads with why it was handed over, the priority the assistant saw, the
 * suggested queue and what it verified: agent-core's `request_summary.text` is often generic
 * ("Una política exigió atención humana…"), so it goes last, as "Qué pide".
 *
 * Also the close dialog's "¿Te sirvió el traspaso?" options (`handoffQuality`). Pure,
 * unit-tested in handoff.test.ts.
 */
import { isApiProblem } from '@/lib/api'
import type { CasePriority, HandoffQuality } from './types'

/** One line of a section: the main text and an optional muted detail. */
export interface HandoffItem {
  key: string
  text: string
  detail: string | null
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
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.trim() || null
  const json = JSON.stringify(value)
  return json.length > 120 ? `${json.slice(0, 119)}…` : json
}

/** agent-core's reason codes (`ReasonCode`) → why the analyst has the case. */
const REASONS: Record<string, string> = {
  low_confidence: 'No estaba seguro de la respuesta',
  budget_exceeded: 'La conversación se alargó más de lo previsto',
  tool_failure: 'Falló una consulta que necesitaba',
  customer_request: 'El cliente pidió hablar con una persona',
  verification_failed: 'No pudo verificar la identidad del cliente',
  validation_failed: 'Una respuesta no pasó la validación',
  release_revoked: 'Se retiró la versión del asistente',
  auth_insufficient: 'Hacía falta más verificación de la que tenía',
}

/** `reason_code` → a sentence and, for `policy:` / `rule:` / `interrupt:` codes, their name. */
export function handoffReason(code: string | null): { reason: string; detail: string | null } {
  if (!code) return { reason: 'El asistente lo pasó a una persona', detail: null }
  const known = REASONS[code]
  if (known) return { reason: known, detail: null }
  const [prefix, name = ''] = code.split(/:(.*)/s)
  const detail = name ? humanizeKey(name) : null
  switch (prefix) {
    case 'policy':
      return { reason: 'Una política pide que lo atienda una persona', detail }
    case 'rule':
      return { reason: 'Una regla del asistente lo pasó a una persona', detail }
    // agent-core interrupts the flow on a situation only a person may handle ("interrupt:fraude").
    case 'interrupt':
      return { reason: 'Detectó algo que debe atender una persona', detail }
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

const FACT_SOURCES: Record<string, string> = {
  tool: 'De una consulta',
  compute: 'Calculado',
  identity: 'De la identidad del cliente',
  knowledge: 'De la base de conocimiento',
  agent: 'Del asistente',
}

/** agent-core's `ActionState` → a word ("Hecha", "Falló"). */
const ACTION_STATES: Record<string, string> = {
  proposed: 'Propuesta',
  confirmed: 'Confirmada por el cliente',
  executing: 'En curso',
  executed: 'Hecha',
  uncertain: 'Sin confirmar si se hizo',
  denied: 'Rechazada',
  verified: 'Hecha y verificada',
  failed: 'Falló',
  cancelled: 'Cancelada',
}

/** A tool reference: `"radicar_pqr@1.0.0"` or `{ id, version }` → "Radicar pqr". */
function toolName(tool: unknown): string {
  const text = asText(tool) ?? asText(asRecord(tool)?.id)
  return text ? humanizeKey(text) : 'Una acción'
}

function namedValue(entry: Json): string | null {
  const name = asText(entry.name)
  if (!name) return null
  const value = formatValue(entry.value)
  return value ? `${humanizeKey(name)}: ${value}` : humanizeKey(name)
}

/** The packet → the analyst's view. Anything unreadable is left out. */
export function readHandoff(packet: Json): HandoffView {
  const { reason, detail } = handoffReason(asText(packet.reason_code))
  const priority = PRIORITIES[(asText(packet.priority) ?? '').toLowerCase()] ?? null
  const queue = asText(packet.target_queue)
  const verified = asList(packet.verified_facts).flatMap((raw, index): HandoffItem[] => {
    const entry = asRecord(raw)
    const text = entry ? namedValue(entry) : null
    if (!entry || !text) return []
    const kind = asText(asRecord(entry.source)?.kind)
    return [
      {
        key: asText(entry.fact_id) ?? `fact-${index}`,
        text,
        detail: kind ? (FACT_SOURCES[kind] ?? null) : null,
      },
    ]
  })
  const claimed = asList(packet.claimed_not_verified).flatMap((raw, index): HandoffItem[] => {
    const entry = asRecord(raw)
    const text = entry ? namedValue(entry) : null
    return entry && text ? [{ key: `claim-${index}`, text, detail: null }] : []
  })
  const actions = asList(packet.actions_taken).flatMap((raw, index): HandoffItem[] => {
    const entry = asRecord(raw)
    if (!entry) return []
    const state = asText(entry.state)
    return [
      {
        key: asText(entry.action_id) ?? `action-${index}`,
        text: toolName(entry.tool),
        detail: state ? (ACTION_STATES[state] ?? humanizeKey(state)) : null,
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
  if (count === 0) return 'Nada verificado'
  return count === 1 ? '1 dato verificado' : `${count} datos verificados`
}

/** The empty line of each section of the "Traspaso" tab. */
export const HANDOFF_EMPTY = {
  verified: 'El asistente no verificó ningún dato.',
  claimed: 'Nada pendiente de verificar.',
  actions: 'El asistente no hizo ninguna acción.',
  open: 'No dejó preguntas abiertas.',
  summary: 'El asistente no dejó un resumen.',
} as const

/** The handoff could not be read: a retry for an agent-core outage, nothing for the rest. */
export interface HandoffFailure {
  title: string
  description: string
  retry: boolean
}

export function describeHandoffFailure(error: unknown): HandoffFailure {
  if (isApiProblem(error, 'agent_core_unavailable') || isApiProblem(error, 'agent_core_rejected')) {
    return {
      title: 'No pudimos traer el traspaso del asistente',
      description: 'La conversación sigue disponible. Vuelve a intentarlo en un momento.',
      retry: true,
    }
  }
  if (isApiProblem(error, 'network_error')) {
    return {
      title: 'No pudimos traer el traspaso del asistente',
      description: 'Revisa tu conexión. La conversación sigue disponible.',
      retry: true,
    }
  }
  return {
    title: 'El traspaso del asistente no está disponible',
    description: 'La conversación sigue disponible.',
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
  label: string
  description: string
  icon: 'thumbs-up' | 'puzzle' | 'circle-minus'
  tone: 'success' | 'warn' | 'neutral'
}

export const HANDOFF_QUALITY_OPTIONS: readonly HandoffQualityOption[] = [
  {
    value: 'useful',
    label: 'Útil',
    description: 'Tenía lo que necesitabas.',
    icon: 'thumbs-up',
    tone: 'success',
  },
  {
    value: 'incomplete',
    label: 'Incompleto',
    description: 'Faltaba algo importante.',
    icon: 'puzzle',
    tone: 'warn',
  },
  {
    value: 'unnecessary',
    label: 'Innecesario',
    description: 'No hacía falta pasarlo a una persona.',
    icon: 'circle-minus',
    tone: 'neutral',
  },
]

export const HANDOFF_QUALITY_LEGEND = '¿Te sirvió el traspaso del asistente?'
export const HANDOFF_QUALITY_HINT =
  'Se lo enviamos al asistente para que mejore. Si no sabes, déjalo sin marcar.'

/** Picking the selected option again clears it (the label is optional). */
export function toggleHandoffQuality(
  current: HandoffQuality | null,
  picked: HandoffQuality,
): HandoffQuality | null {
  return current === picked ? null : picked
}
