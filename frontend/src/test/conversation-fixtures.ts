import type { CaseDetail, CaseHistory, CaseHistoryItem, Turn } from '@/features/conversation'
import type { Escalation } from '@/features/cases'
import type {
  CustomerConversation,
  CustomerConversationSummary,
  CustomerTurn,
  DemoCustomer,
} from '@/features/customer-chat'
import type { RealtimeEnvelope } from '@/lib/realtime'
import { makeCaseSummary } from './case-fixtures'
import { analystStaff } from './fixtures'

/**
 * Invented conversations for tests ("Datos de ejemplo"): people, ids and texts
 * follow the slice 2 seed stories (contract §8), never dataset records.
 */

export const CASE_ID = 'CASE-00000000000000000000000101'
export const CUSTOMER_ID = 'CUS-00000000000000000000001001'
const ME = analystStaff.id
/** Another analyst (Julián), who held case 110 of Patricia. */
export const OTHER_ANALYST_ID = 'STF-ANA0000002'

let turnCounter = 0

export function makeTurn(overrides: Partial<Turn> = {}): Turn {
  turnCounter += 1
  const sequence = overrides.sequence ?? turnCounter
  return {
    id: `TRN-${String(sequence).padStart(4, '0')}-${(overrides.caseId ?? CASE_ID).slice(-3)}`,
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
    ...overrides,
  }
}

/** Marcela's web chat (seed 101): message, opened notice, assignment banner, reply, message. */
export function seededTurns(): Turn[] {
  return [
    makeTurn({ sequence: 1 }),
    makeTurn({
      sequence: 2,
      kind: 'notice',
      authorRole: 'system',
      authorId: null,
      authorName: null,
      text: 'Recibimos tu mensaje. En unos minutos te responde una persona del equipo.',
    }),
    makeTurn({
      sequence: 3,
      kind: 'routing',
      audience: 'staff',
      authorRole: 'system',
      authorId: null,
      authorName: null,
      text: 'Asignado a Daniela Ríos porque está disponible y habla español.',
    }),
    makeTurn({
      sequence: 4,
      authorRole: 'analyst',
      authorId: ME,
      authorName: 'Daniela Ríos',
      text: 'Hola, Marcela. Soy Daniela, de LATAM Bank. ¿Me cuenta de qué fecha es el cargo?',
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
  const summary = makeCaseSummary({ lastSequence: 4, assignedAnalystId: ME, unreadCount: 0 })
  return {
    case: summary,
    customer: {
      id: CUSTOMER_ID,
      displayName: 'Marcela Quintana Pardo',
      country: 'CO',
      city: 'Barranquilla',
      locale: 'es-CO',
      language: 'es',
    },
    assignment: {
      id: 'ASG-0001',
      analystId: ME,
      analystName: 'Daniela Ríos',
      reason: 'language_least_loaded',
      policyRuleId: null,
      assignedAt: '2026-03-05T15:46:10Z',
      queueLabel: null,
      waitedSeconds: null,
      assignedByRole: 'system',
      assignedByName: null,
      previousAnalystId: null,
      previousAnalystName: null,
    },
    closure: null,
    capabilities: {
      canReply: true,
      replyBlockedReason: null,
      canClose: true,
      canAssign: false,
      canChangePriority: true,
      canEscalate: false,
    },
    previousCaseCount: 0,
    escalation: null,
    ...overrides,
  }
}

/** Case 108 of Patricia closed by me (Cerrados): read-only with its closure. */
export function makeClosedDetail(overrides: Partial<CaseDetail> = {}): CaseDetail {
  const detail = makeCaseDetail()
  return {
    ...detail,
    case: {
      ...detail.case,
      status: 'closed',
      inboxStatus: 'closed',
      closedAt: '2026-03-05T15:58:00Z',
      closeReason: 'resolved',
      version: 9,
    },
    closure: {
      closedAt: '2026-03-05T15:58:00Z',
      closedById: ME,
      closedByName: 'Daniela Ríos',
      reason: 'resolved',
      note: 'Se explicó el plazo del reverso (5 días hábiles).',
    },
    capabilities: {
      canReply: false,
      replyBlockedReason: 'closed',
      canClose: false,
      canAssign: false,
      canChangePriority: false,
      canEscalate: false,
    },
    ...overrides,
  }
}

export const PATRICIA_CASE_ID = 'CASE-00000000000000000000000108'
export const JULIAN_CASE_ID = 'CASE-00000000000000000000000110'

export function makeHistoryItem(overrides: Partial<CaseHistoryItem> = {}): CaseHistoryItem {
  return {
    id: 'CASE-00000000000000000000000104',
    status: 'closed',
    channel: 'app_chat',
    openedAt: '2026-03-03T15:30:00Z',
    closedAt: '2026-03-03T16:00:00Z',
    closeReason: 'resolved',
    analystId: ME,
    analystName: 'Daniela Ríos',
    preview: 'Perfecto, muchas gracias.',
    rating: null,
    ...overrides,
  }
}

/** Patricia's other cases (contract §8.3): 104 (Daniela) and 110 (Julián), newest first. */
export const patriciaHistory: CaseHistory = {
  items: [
    makeHistoryItem({
      rating: {
        score: 4,
        comment: 'Muy clara la explicación del plazo, gracias.',
        ratedAt: '2026-03-03T16:02:00Z',
      },
    }),
    makeHistoryItem({
      id: JULIAN_CASE_ID,
      channel: 'web_chat',
      openedAt: '2026-02-13T15:00:00Z',
      closedAt: '2026-02-13T15:15:00Z',
      analystId: OTHER_ANALYST_ID,
      analystName: 'Julián Ortega',
      preview: 'Ah, es cierto. Gracias.',
      rating: { score: 3, comment: null, ratedAt: '2026-02-13T15:16:00Z' },
    }),
  ],
  total: 2,
}

/** Julián's closed case 110, as Daniela reads it through history access. */
export function makeJulianDetail(): CaseDetail {
  const base = makeCaseDetail()
  return {
    case: makeCaseSummary({
      id: JULIAN_CASE_ID,
      customer: { id: 'CUS-00000000000000000000001004', displayName: 'Patricia Lozano Vega' },
      status: 'closed',
      inboxStatus: 'closed',
      assignedAnalystId: OTHER_ANALYST_ID,
      closedAt: '2026-02-13T15:15:00Z',
      closeReason: 'resolved',
      lastSequence: 4,
      unreadCount: 0,
    }),
    customer: {
      ...base.customer,
      id: 'CUS-00000000000000000000001004',
      displayName: 'Patricia Lozano Vega',
      country: 'MX',
      city: 'Guadalajara',
      locale: 'es-MX',
    },
    assignment: {
      id: 'ASG-0110',
      analystId: OTHER_ANALYST_ID,
      analystName: 'Julián Ortega',
      reason: 'language_least_loaded',
      policyRuleId: null,
      assignedAt: '2026-02-13T15:00:10Z',
      queueLabel: null,
      waitedSeconds: null,
      assignedByRole: 'system',
      assignedByName: null,
      previousAnalystId: null,
      previousAnalystName: null,
    },
    closure: {
      closedAt: '2026-02-13T15:15:00Z',
      closedById: OTHER_ANALYST_ID,
      closedByName: 'Julián Ortega',
      reason: 'resolved',
      note: null,
    },
    capabilities: {
      canReply: false,
      replyBlockedReason: 'closed',
      canClose: false,
      canAssign: false,
      canChangePriority: false,
      canEscalate: false,
    },
    previousCaseCount: 2,
    escalation: null,
  }
}

export function julianTurns(): Turn[] {
  const caseId = JULIAN_CASE_ID
  return [
    makeTurn({
      caseId,
      sequence: 1,
      authorId: 'CUS-00000000000000000000001004',
      authorName: 'Patricia Lozano Vega',
      text: 'Hola, no reconozco un cargo de una suscripción.',
    }),
    makeTurn({
      caseId,
      sequence: 2,
      authorRole: 'analyst',
      authorId: OTHER_ANALYST_ID,
      authorName: 'Julián Ortega',
      text: 'Hola, Patricia. Soy Julián, de LATAM Bank. Ese cargo es de su suscripción de música.',
    }),
    makeTurn({
      caseId,
      sequence: 3,
      authorId: 'CUS-00000000000000000000001004',
      authorName: 'Patricia Lozano Vega',
      text: 'Ah, es cierto. Gracias.',
    }),
  ]
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

// ── Escalations (slice 9) ───────────────────────────────────────────────────

/** Daniela escalated Marcela's 101 six minutes before NOW (open). */
export function makeEscalation(overrides: Partial<Escalation> = {}): Escalation {
  return {
    id: 'ESC-00000000000000000000000101',
    caseId: CASE_ID,
    customerName: 'Marcela Quintana Pardo',
    state: 'open',
    motive:
      'La clienta pide hablar con supervisión: no reconoce un retiro en cajero y no quiere esperar el proceso normal.',
    escalatedAt: '2026-03-05T15:54:00Z',
    escalatedById: ME,
    escalatedByName: 'Daniela Ríos',
    resolvedAt: null,
    resolvedById: null,
    resolvedByName: null,
    note: null,
    reassignedToId: null,
    reassignedToName: null,
    acknowledgedAt: null,
    ...overrides,
  }
}

/** Lucía answered it one minute before NOW. */
export function makeAnsweredEscalation(overrides: Partial<Escalation> = {}): Escalation {
  return makeEscalation({
    state: 'answered',
    resolvedAt: '2026-03-05T15:59:00Z',
    resolvedById: 'STF-SUP0000001',
    resolvedByName: 'Lucía Herrera',
    note: 'Ya hablé con ella por aquí. Sigue tú con el caso.',
    ...overrides,
  })
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
    suggestions: ['Olá, não reconheço uma compra no meu cartão', 'Quero falar com uma pessoa'],
    openConversation: null,
    closedConversationCount: 0,
  },
  {
    id: 'CUS-00000000000000000000001007',
    displayName: 'Joaquín Ferreyra Paz',
    locale: 'es-AR',
    language: 'es',
    country: 'AR',
    city: 'Rosario',
    suggestions: ['Fue a mediados de mes, unos $48.300', '¿Lo pudiste encontrar?'],
    openConversation: {
      caseId: 'CASE-00000000000000000000000107',
      channel: 'app_chat',
      status: 'with_agent',
    },
    closedConversationCount: 0,
  },
  {
    id: 'CUS-00000000000000000000001005',
    displayName: 'Claudia Restrepo Varela',
    locale: 'es-CO',
    language: 'es',
    country: 'CO',
    city: 'Barranquilla',
    suggestions: ['Hola, sigo con el problema del cargo'],
    openConversation: null,
    closedConversationCount: 1,
  },
  {
    id: 'CUS-00000000000000000000001008',
    displayName: 'Gabriela Duarte Melo',
    locale: 'pt-BR',
    language: 'pt',
    country: 'BR',
    city: 'São Paulo',
    suggestions: ['Alguém aí?'],
    openConversation: {
      caseId: 'CASE-00000000000000000000000109',
      channel: 'web_chat',
      status: 'waiting_agent',
    },
    closedConversationCount: 0,
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
    previousCaseId: null,
    rating: null,
    ...overrides,
  }
}

export function makePastSummary(
  overrides: Partial<CustomerConversationSummary> = {},
): CustomerConversationSummary {
  return {
    caseId: 'CASE-00000000000000000000000105',
    status: 'closed',
    channel: 'web_chat',
    openedAt: '2026-03-04T13:00:00Z',
    closedAt: '2026-03-04T16:00:00Z',
    agentName: 'Daniela',
    preview: 'Hola, Claudia. Soy Daniela, de LATAM Bank. ¿Me cuenta qué cargo es y de qué fecha?',
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
