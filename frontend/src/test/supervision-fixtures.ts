import type { QueueOverview, TeamAnalyst, TeamOverview, TeamSummary } from '@/features/supervision'
import { NOW, makeCaseSummary, minutesFrom, seededInbox } from './case-fixtures'
import { TEAM_ANDES, TEAM_PACIFICO } from './fixtures'

/**
 * Invented team and queues for tests ("Datos de ejemplo"): people, ids and texts
 * follow the slice 3 seed story (contract §9), never dataset records.
 */

export const DANIELA_ID = 'STF-ANA0000001'
export const JULIAN_ID = 'STF-ANA0000002'
export const PAULA_ID = 'STF-ANA0000003'
export const SEBASTIAN_ID = 'STF-ANA0000004'
export const TOMAS_ID = 'STF-ANA0000005'
export const FELIPE_ID = 'STF-SUP0000009'

export const ANDES = TEAM_ANDES
export const PACIFICO = TEAM_PACIFICO

/** Rosa's queued case (111): Spanish, SLA at risk (2 min left). */
export const queuedRosa = makeCaseSummary({
  id: 'CASE-00000000000000000000000111',
  version: 2,
  customer: { id: 'CUS-00000000000000000000001009', displayName: 'Rosa Elena Ibarra Méndez' },
  channel: 'app_chat',
  status: 'queued',
  inboxStatus: null,
  openedAt: minutesFrom(-13),
  slaDueAt: minutesFrom(2),
  firstResponseAt: null,
  lastInteractionAt: minutesFrom(-13),
  preview: 'Buenas, me llegó un cobro de una suscripción que cancelé hace meses.',
  assignedAnalystId: null,
  unreadCount: 1,
  lastSequence: 3,
})

/** Mauricio's queued case (112): Spanish, high priority, SLA overdue. */
export const queuedMauricio = makeCaseSummary({
  id: 'CASE-00000000000000000000000112',
  version: 3,
  customer: { id: 'CUS-00000000000000000000001010', displayName: 'Mauricio Achával Ríos' },
  priority: 'high',
  status: 'queued',
  inboxStatus: null,
  openedAt: minutesFrom(-8),
  slaDueAt: minutesFrom(-3),
  firstResponseAt: null,
  lastInteractionAt: minutesFrom(-4),
  preview: '¿Alguien me puede atender?',
  assignedAnalystId: null,
  unreadCount: 2,
  lastSequence: 4,
})

/** Gabriela's queued case (109): Portuguese. */
export const queuedGabriela = makeCaseSummary({
  id: 'CASE-00000000000000000000000109',
  version: 2,
  customer: { id: 'CUS-00000000000000000000001008', displayName: 'Gabriela Duarte Melo' },
  language: 'pt',
  status: 'queued',
  inboxStatus: null,
  openedAt: minutesFrom(-6),
  slaDueAt: minutesFrom(9),
  firstResponseAt: null,
  lastInteractionAt: minutesFrom(-6),
  preview: 'Alguém aí?',
  assignedAnalystId: null,
  unreadCount: 1,
  lastSequence: 3,
})

/** Camila's case (113), Julián's: to reply, first response pending, SLA overdue. */
export const julianCamila = makeCaseSummary({
  id: 'CASE-00000000000000000000000113',
  version: 6,
  customer: { id: 'CUS-00000000000000000000001011', displayName: 'Camila Torres Benavides' },
  channel: 'app_chat',
  status: 'in_progress',
  inboxStatus: 'to_reply',
  openedAt: minutesFrom(-25),
  slaDueAt: minutesFrom(-10),
  firstResponseAt: null,
  lastInteractionAt: minutesFrom(-12),
  preview: '¿Me ayudan por favor?',
  assignedAnalystId: JULIAN_ID,
  unreadCount: 1,
  lastSequence: 4,
})

/** Esteban's case (114), reassigned by Lucía from Paula to Julián: waiting. */
export const julianEsteban = makeCaseSummary({
  id: 'CASE-00000000000000000000000114',
  version: 8,
  customer: { id: 'CUS-00000000000000000000001012', displayName: 'Esteban Morales Quiroga' },
  priority: 'low',
  status: 'in_progress',
  inboxStatus: 'waiting',
  openedAt: minutesFrom(-40),
  slaDueAt: minutesFrom(20),
  firstResponseAt: minutesFrom(-30),
  lastInteractionAt: minutesFrom(-30),
  preview: 'Hola, Esteban. Soy Julián, de LATAM Bank.',
  previewAuthorRole: 'analyst',
  assignedAnalystId: JULIAN_ID,
  unreadCount: 0,
  lastSequence: 6,
})

export function makeAnalyst(overrides: Partial<TeamAnalyst> = {}): TeamAnalyst {
  return {
    id: PAULA_ID,
    name: 'Paula Medina',
    team: PACIFICO,
    languages: ['es'],
    roles: ['analyst'],
    availability: 'paused',
    availabilitySince: null,
    signedIn: false,
    activity: 'offline',
    counts: { open: 0, new: 0, toReply: 0, waiting: 0 },
    oldestWaitingSince: null,
    openCases: [],
    ...overrides,
  }
}

/** Daniela: available without a session, 5 open (Carga alta), Beatriz at SLA risk. */
export const daniela = makeAnalyst({
  id: DANIELA_ID,
  name: 'Daniela Ríos',
  team: ANDES,
  languages: ['es', 'pt'],
  availability: 'available',
  availabilitySince: minutesFrom(-60),
  signedIn: false,
  activity: 'busy',
  counts: { open: 5, new: 2, toReply: 2, waiting: 1 },
  oldestWaitingSince: minutesFrom(-4),
  openCases: seededInbox,
})

/** Julián: paused with a session ("En pausa"), 2 open, Camila overdue. */
export const julian = makeAnalyst({
  id: JULIAN_ID,
  name: 'Julián Ortega',
  team: ANDES,
  availability: 'paused',
  availabilitySince: minutesFrom(-20),
  signedIn: true,
  activity: 'paused',
  counts: { open: 2, new: 0, toReply: 1, waiting: 1 },
  oldestWaitingSince: minutesFrom(-12),
  openCases: [julianCamila, julianEsteban],
})

export const paula = makeAnalyst()

export const sebastian = makeAnalyst({
  id: SEBASTIAN_ID,
  name: 'Sebastián Cárdenas',
  languages: ['es', 'pt'],
})

export const tomas = makeAnalyst({ id: TOMAS_ID, name: 'Tomás Arango', languages: ['es', 'pt'] })

export const felipe = makeAnalyst({
  id: FELIPE_ID,
  name: 'Felipe Echeverri',
  team: ANDES,
  roles: ['analyst', 'supervisor'],
})

export const seededAnalysts: TeamAnalyst[] = [daniela, julian, felipe, paula, sebastian, tomas]

export function makeTeamSummary(overrides: Partial<TeamSummary> = {}): TeamSummary {
  return {
    ...ANDES,
    analystCount: 3,
    activity: { busy: 1, available: 0, paused: 1, offline: 1 },
    openCases: 7,
    atRiskCases: 2,
    ...overrides,
  }
}

export function makeTeamOverview(overrides: Partial<TeamOverview> = {}): TeamOverview {
  return {
    teams: [
      makeTeamSummary(),
      makeTeamSummary({
        ...PACIFICO,
        activity: { busy: 0, available: 0, paused: 0, offline: 3 },
        openCases: 0,
        atRiskCases: 0,
      }),
    ],
    analysts: seededAnalysts,
    serverTime: NOW.toISOString(),
    ...overrides,
  }
}

export function makeQueueOverview(overrides: Partial<QueueOverview> = {}): QueueOverview {
  return {
    queues: [
      {
        language: 'es',
        label: 'Cola en español',
        waiting: 2,
        oldestQueuedAt: queuedRosa.openedAt,
        atRisk: 2,
        availableSpeakers: 1,
        speakers: 6,
        cases: [queuedRosa, queuedMauricio],
      },
      {
        language: 'pt',
        label: 'Cola en portugués',
        waiting: 1,
        oldestQueuedAt: queuedGabriela.openedAt,
        atRisk: 0,
        availableSpeakers: 1,
        speakers: 3,
        cases: [queuedGabriela],
      },
    ],
    counts: {
      total: 3,
      byLanguage: [
        { language: 'es', waiting: 2, oldestQueuedAt: queuedRosa.openedAt },
        { language: 'pt', waiting: 1, oldestQueuedAt: queuedGabriela.openedAt },
      ],
      computedAt: NOW.toISOString(),
    },
    serverTime: NOW.toISOString(),
    ...overrides,
  }
}

export const emptyQueues: QueueOverview = makeQueueOverview({
  queues: [
    {
      language: 'es',
      label: 'Cola en español',
      waiting: 0,
      oldestQueuedAt: null,
      atRisk: 0,
      availableSpeakers: 1,
      speakers: 6,
      cases: [],
    },
    {
      language: 'pt',
      label: 'Cola en portugués',
      waiting: 0,
      oldestQueuedAt: null,
      atRisk: 0,
      availableSpeakers: 1,
      speakers: 3,
      cases: [],
    },
  ],
  counts: {
    total: 0,
    byLanguage: [
      { language: 'es', waiting: 0, oldestQueuedAt: null },
      { language: 'pt', waiting: 0, oldestQueuedAt: null },
    ],
    computedAt: NOW.toISOString(),
  },
})
