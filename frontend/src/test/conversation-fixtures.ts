import type { CaseDetail, Turn } from '@/features/conversation'
import type { CustomerConversation, CustomerTurn, DemoCustomer } from '@/features/customer-chat'
import type { RealtimeEnvelope } from '@/lib/realtime'
import { makeCaseSummary } from './case-fixtures'
import { analystStaff } from './fixtures'

/**
 * Invented conversations for tests ("Datos de ejemplo"): people, ids and texts
 * follow the slice 1 seed stories (contract §6), never dataset records.
 */

export const CASE_ID = 'CASE-00000000000000000000000101'
export const CUSTOMER_ID = 'CUS-00000000000000000000001001'
const ME = analystStaff.id

let turnCounter = 0

export function makeTurn(overrides: Partial<Turn> = {}): Turn {
  turnCounter += 1
  const sequence = overrides.sequence ?? turnCounter
  return {
    id: `TRN-${String(sequence).padStart(4, '0')}-${CASE_ID.slice(-3)}`,
    caseId: CASE_ID,
    sequence,
    kind: 'message',
    audience: 'everyone',
    authorRole: 'customer',
    authorId: CUSTOMER_ID,
    authorName: 'Marcela Quintana Pardo',
    text: 'hola buenas, hay un cargo en mi tarjeta q no reconozco, me colaboran?',
    language: 'es',
    createdAt: new Date(Date.UTC(2026, 2, 5, 15, 46, sequence)).toISOString(),
    clientMessageId: null,
    evidenceIds: [],
    fromSuggestionId: null,
    ...overrides,
  }
}

/** Ana's web-chat dispute (seed 101), shortened: customer, bot, customer, routing banner. */
export function seededTurns(): Turn[] {
  return [
    makeTurn({ sequence: 1 }),
    makeTurn({
      sequence: 2,
      authorRole: 'tree',
      authorId: 'tree.disputas@ejemplo',
      authorName: 'Árbol de decisión',
      text: '¿El cargo que no reconoce es el de un retiro en cajero por $1.585.208 COP, del 9 ene?',
    }),
    makeTurn({ sequence: 3, text: 'si, ese es' }),
    makeTurn({
      sequence: 4,
      kind: 'routing',
      audience: 'staff',
      authorRole: 'system',
      authorId: null,
      authorName: null,
      text: 'Escalado por el agente de disputas: el retiro supera $1.000.000 (regla 10) y el abono lo decide una persona (regla 6).',
    }),
  ]
}

export function makeAnalystTurn(sequence: number, text: string, clientMessageId: string): Turn {
  return makeTurn({
    sequence,
    authorRole: 'analyst',
    authorId: ME,
    authorName: 'Daniela Ríos',
    text,
    clientMessageId,
  })
}

export function makeCaseDetail(overrides: Partial<CaseDetail> = {}): CaseDetail {
  const summary = makeCaseSummary({ lastSequence: 4, assignedAnalystId: ME })
  return {
    case: summary,
    customer: {
      id: CUSTOMER_ID,
      displayName: 'Marcela Quintana Pardo',
      segment: 'Plus',
      country: 'CO',
      city: 'Barranquilla',
      locale: 'es-CO',
      language: 'es',
      customerSince: '2019-04-01',
      documentType: 'CC',
    },
    channelIdentity: { kind: 'web_session', verified: true },
    assignment: {
      id: 'ASG-0001',
      analystId: ME,
      analystName: 'Daniela Ríos',
      reason: 'language_least_loaded',
      policyRuleId: null,
      assignedAt: '2026-03-05T15:58:10Z',
    },
    routing: {
      stops: [
        stop({
          kind: 'tier',
          tier: 'judge',
          outcome: 'abstained',
          reasonCode: 'component_not_connected',
        }),
        stop({
          kind: 'tier',
          tier: 'tree',
          outcome: 'abstained',
          reasonCode: 'component_not_connected',
        }),
        stop({
          kind: 'tier',
          tier: 'ai_agent',
          outcome: 'abstained',
          reasonCode: 'component_not_connected',
        }),
        stop({
          kind: 'assignee',
          label: 'Daniela Ríos',
          staffId: ME,
          reasonCode: 'language_least_loaded',
        }),
      ],
      inputsUsed: [],
    },
    closure: null,
    capabilities: { canReply: true, replyBlockedReason: null, canClose: true },
    ...overrides,
  }
}

export function stop(
  overrides: Partial<CaseDetail['routing']['stops'][number]> = {},
): CaseDetail['routing']['stops'][number] {
  return {
    kind: 'tier',
    label: null,
    tier: null,
    componentId: null,
    componentVersion: null,
    outcome: null,
    reasonCode: null,
    policyRuleId: null,
    summary: null,
    staffId: null,
    waitedSeconds: null,
    occurredAt: '2026-03-05T15:58:10Z',
    ...overrides,
  }
}

let envelopeCounter = 0

/** Domain envelope as the server pushes it (`data.payload` = REST schema). */
export function envelope(type: string, payload: unknown, caseId = CASE_ID): RealtimeEnvelope {
  envelopeCounter += 1
  return {
    type,
    id: `EVT-${envelopeCounter}`,
    occurredAt: '2026-03-05T16:00:00Z',
    data: {
      entity: 'case',
      entityId: caseId,
      caseId,
      actor: { role: 'system', id: null },
      payload,
    },
  }
}

// ── Customer simulator ──────────────────────────────────────────────────────

/** Unsigned JWT-shaped customer token (the SPA only reads `sub`, `aud` and `exp`). */
export function fakeCustomerToken(
  customerId: string,
  {
    expiresInSeconds = 3600,
    aud = 'cc-customer',
  }: { expiresInSeconds?: number; aud?: string } = {},
): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: customerId, aud, exp, sid: 'CSN-1' })}.firma`
}

export const SIM_CUSTOMER_ID = 'CUS-00000000000000000000002004'
export const SIM_CASE_ID = 'CASE-00000000000000000000009001'

export const demoCustomers: DemoCustomer[] = [
  {
    id: SIM_CUSTOMER_ID,
    displayName: 'Rafael Nogueira Costa',
    locale: 'pt-BR',
    language: 'pt',
    country: 'AR',
    city: 'Buenos Aires',
    segment: 'Plus',
    suggestions: ['Olá, não reconheço uma compra no meu cartão', 'Quero falar com uma pessoa'],
    openConversation: null,
  },
  {
    id: 'CUS-00000000000000000000001007',
    displayName: 'Joaquín Ferreyra Paz',
    locale: 'es-AR',
    language: 'es',
    country: 'AR',
    city: 'Rosario',
    segment: 'Plus',
    suggestions: ['Fue a mediados de mes, unos $48.300', '¿Lo pudiste encontrar?'],
    openConversation: {
      caseId: 'CASE-00000000000000000000000107',
      channel: 'app_chat',
      status: 'with_agent',
    },
  },
]

export function makeCustomerConversation(
  overrides: Partial<CustomerConversation> = {},
): CustomerConversation {
  return {
    caseId: SIM_CASE_ID,
    status: 'waiting_agent',
    channel: 'app_chat',
    language: 'pt',
    openedAt: '2026-03-05T16:00:00Z',
    closedAt: null,
    agentName: null,
    lastSequence: 2,
    ...overrides,
  }
}

export function makeCustomerTurn(overrides: Partial<CustomerTurn> = {}): CustomerTurn {
  const sequence = overrides.sequence ?? 1
  return {
    id: `TRN-C${String(sequence).padStart(4, '0')}`,
    sequence,
    kind: 'message',
    authorRole: 'customer',
    authorName: null,
    text: 'Olá, não reconheço uma compra no meu cartão',
    language: 'pt',
    createdAt: new Date(Date.UTC(2026, 2, 5, 16, 0, sequence)).toISOString(),
    clientMessageId: null,
    ...overrides,
  }
}
