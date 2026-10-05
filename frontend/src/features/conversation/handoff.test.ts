import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import {
  HANDOFF_QUALITY_OPTIONS,
  describeHandoffFailure,
  formatValue,
  handoffReason,
  hasHandoff,
  humanizeKey,
  readHandoff,
  toggleHandoffQuality,
  verifiedCountLabel,
} from './handoff'

/** A packet as agent-core publishes it (HandoffPacket, snake_case). */
const PACKET = {
  handoff_ref: 'hnd-7',
  run_id: 'run-1',
  release: 'recepcion@1.0.0',
  agent: 'recepcion@1.0.0',
  principal_type: 'customer',
  subject: null,
  target_queue: 'disputas',
  priority: 'critical',
  reason_code: 'policy:fraude/robo_tarjeta',
  language: 'es-CO',
  request_summary: { text: 'No reconoce un cargo de 120 USD.', citations: ['charge'] },
  verified_facts: [
    {
      fact_id: 'f1',
      name: 'identity_verified',
      value: true,
      source: { kind: 'identity', ref: 'step_up', inputs: [] },
      ts: '2026-10-04T15:00:00Z',
    },
    {
      fact_id: 'f2',
      name: 'charge_amount',
      value: 120,
      source: { kind: 'tool', ref: 'movimientos@1.0.0', inputs: [] },
      ts: '2026-10-04T15:00:00Z',
    },
    { fact_id: 'f3', name: '', value: 1, source: { kind: 'tool' } },
  ],
  claimed_not_verified: [{ name: 'card_stolen', value: 'ayer', source_turn: 1 }],
  actions_taken: [
    { action_id: 'a1', tool: 'radicar_disputa@1.0.0', state: 'verified', args: {} },
    { action_id: 'a2', tool: { id: 'bloquear_tarjeta', version: '1.0.0' }, state: 'failed' },
  ],
  open_questions: ['¿Hay más cargos desde ayer?', ''],
  evidence_refs: [],
  transcript_ref: 'tr-1',
  degraded_packet: false,
}

describe('readHandoff', () => {
  it('leads with the reason, the priority and the queue', () => {
    const view = readHandoff(PACKET)
    expect(view.reason).toBe('Una política pide que lo atienda una persona')
    expect(view.reasonDetail).toBe('Fraude robo tarjeta')
    expect(view.priority).toBe('critical')
    expect(view.queue).toBe('Disputas')
    expect(view.summary).toBe('No reconoce un cargo de 120 USD.')
    expect(view.degraded).toBe(false)
  })

  it('lists what it verified, what was only claimed, what it did and what is open', () => {
    const view = readHandoff(PACKET)
    expect(view.verified).toEqual([
      { key: 'f1', text: 'Identity verified: Sí', detail: 'De la identidad del cliente' },
      { key: 'f2', text: 'Charge amount: 120', detail: 'De una consulta' },
    ])
    expect(view.claimed).toEqual([{ key: 'claim-0', text: 'Card stolen: ayer', detail: null }])
    expect(view.actions).toEqual([
      { key: 'a1', text: 'Radicar disputa', detail: 'Hecha y verificada' },
      { key: 'a2', text: 'Bloquear tarjeta', detail: 'Falló' },
    ])
    expect(view.open).toEqual([
      { key: 'open-0', text: '¿Hay más cargos desde ayer?', detail: null },
    ])
  })

  it('reads agent-core\'s default "normal" priority as medium and survives a broken packet', () => {
    expect(readHandoff({ ...PACKET, priority: 'normal' }).priority).toBe('medium')
    expect(readHandoff({ ...PACKET, priority: 'whenever' }).priority).toBeNull()
    expect(readHandoff({})).toEqual({
      reason: 'El asistente lo pasó a una persona',
      reasonDetail: null,
      priority: null,
      queue: null,
      summary: null,
      verified: [],
      claimed: [],
      actions: [],
      open: [],
      degraded: false,
    })
    expect(
      readHandoff({ verified_facts: 'x', actions_taken: [null], degraded_packet: true }),
    ).toMatchObject({ verified: [], actions: [], degraded: true })
  })
})

describe('words for agent-core codes', () => {
  it('humanizes reason codes', () => {
    expect(handoffReason('customer_request').reason).toBe('El cliente pidió hablar con una persona')
    expect(handoffReason('verification_failed').reason).toBe(
      'No pudo verificar la identidad del cliente',
    )
    expect(handoffReason('rule:monto_alto')).toEqual({
      reason: 'Una regla del asistente lo pasó a una persona',
      detail: 'Monto alto',
    })
    expect(handoffReason('interrupt:timeout').reason).toBe('El asistente se interrumpió')
    expect(handoffReason('something_new')).toEqual({ reason: 'Something new', detail: null })
    expect(handoffReason(null).reason).toBe('El asistente lo pasó a una persona')
  })

  it('writes keys and values as short lines', () => {
    expect(humanizeKey('radicar_pqr@1.0.0')).toBe('Radicar pqr')
    expect(formatValue(false)).toBe('No')
    expect(formatValue(null)).toBeNull()
    expect(formatValue({ a: 'x'.repeat(200) })).toHaveLength(120)
  })

  it('counts verified facts', () => {
    expect(verifiedCountLabel(0)).toBe('Nada verificado')
    expect(verifiedCountLabel(1)).toBe('1 dato verificado')
    expect(verifiedCountLabel(3)).toBe('3 datos verificados')
  })
})

describe('describeHandoffFailure', () => {
  it('offers a retry when agent-core does not answer, never blocking the conversation', () => {
    for (const [status, code] of [
      [503, 'agent_core_unavailable'],
      [502, 'agent_core_rejected'],
    ] as const) {
      expect(describeHandoffFailure(new ApiProblem({ status, code }))).toEqual({
        title: 'No pudimos traer el traspaso del asistente',
        description: 'La conversación sigue disponible. Vuelve a intentarlo en un momento.',
        retry: true,
      })
    }
    expect(describeHandoffFailure(ApiProblem.network()).retry).toBe(true)
    expect(
      describeHandoffFailure(new ApiProblem({ status: 404, code: 'handoff_unavailable' })).retry,
    ).toBe(false)
  })
})

describe('hasHandoff', () => {
  it('is hers only when the assistant handed it to her', () => {
    const assignment = { reason: 'assistant_handoff', analystId: 'STF-1' }
    expect(hasHandoff({ assignment }, 'STF-1')).toBe(true)
    expect(hasHandoff({ assignment }, 'STF-2')).toBe(false)
    expect(hasHandoff({ assignment: { ...assignment, reason: 'manual' } }, 'STF-1')).toBe(false)
    expect(hasHandoff({ assignment: null }, 'STF-1')).toBe(false)
  })
})

describe('"¿Te sirvió el traspaso?"', () => {
  it('offers Útil, Incompleto and Innecesario; picking one again clears it', () => {
    expect(HANDOFF_QUALITY_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ['useful', 'Útil'],
      ['incomplete', 'Incompleto'],
      ['unnecessary', 'Innecesario'],
    ])
    expect(toggleHandoffQuality(null, 'useful')).toBe('useful')
    expect(toggleHandoffQuality('useful', 'incomplete')).toBe('incomplete')
    expect(toggleHandoffQuality('useful', 'useful')).toBeNull()
  })
})
