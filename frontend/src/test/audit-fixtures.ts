import type { AuditEvent, AuditEventPage } from '@/features/audit'

/**
 * Invented audit events for tests ("Datos de ejemplo"): people and ids follow
 * the slice 3 seed story (contract §9), never dataset records.
 */

export const LUCIA_ID = 'STF-SUP0000002'

let counter = 0

/** Lucía reassigning Esteban's case from Paula to Julián (seed 114). */
export function makeAuditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  counter += 1
  return {
    id: `EVT-${String(counter).padStart(6, '0')}`,
    type: 'case.assigned',
    family: 'assignment',
    changesState: true,
    description: 'Reasignó el caso de Paula Medina a Julián Ortega',
    occurredAt: '2026-03-05T16:02:05Z',
    ingestedAt: '2026-03-05T16:02:05Z',
    actor: { role: 'supervisor', id: LUCIA_ID, name: 'Lucía Herrera' },
    entity: 'case',
    entityId: 'CASE-00000000000000000000000114',
    caseRef: { id: 'CASE-00000000000000000000000114', customerName: 'Esteban Morales Quiroga' },
    payload: {
      analyst_id: 'STF-ANA0000002',
      previous_analyst_id: 'STF-ANA0000003',
      reason: 'manual',
      paused_override: false,
    },
    redactedFields: [],
    ...overrides,
  }
}

/** Esteban's message, its text removed by the PII policy. */
export function makeRedactedTurnEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return makeAuditEvent({
    type: 'turn.created',
    family: 'conversation',
    changesState: false,
    description: 'Escribió un mensaje',
    occurredAt: '2026-03-05T15:20:00Z',
    actor: {
      role: 'customer',
      id: 'CUS-00000000000000000000001012',
      name: 'Esteban Morales Quiroga',
    },
    entity: 'turn',
    entityId: 'TRN-0001',
    payload: { kind: 'message', audience: 'everyone', text_length: 58 },
    redactedFields: ['text'],
    ...overrides,
  })
}

/** Julián going on pause: no case. */
export function makePauseEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return makeAuditEvent({
    type: 'staff.availability_changed',
    family: 'availability',
    changesState: true,
    description: 'Pasó a En pausa',
    occurredAt: '2026-03-04T21:00:00Z',
    actor: { role: 'analyst', id: 'STF-ANA0000002', name: 'Julián Ortega' },
    entity: 'staff',
    entityId: 'STF-ANA0000002',
    caseRef: null,
    payload: { from: 'available', to: 'paused' },
    ...overrides,
  })
}

export function makeAuditPage(
  items: AuditEvent[] = [makeAuditEvent(), makeRedactedTurnEvent(), makePauseEvent()],
  nextCursor: string | null = null,
): AuditEventPage {
  return { items, nextCursor }
}
