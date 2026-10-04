import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { NOW, minutesFrom, seededInbox } from '@/test/case-fixtures'
import {
  ANDES,
  PACIFICO,
  DANIELA_ID,
  JULIAN_ID,
  daniela,
  felipe,
  julian,
  julianCamila,
  makeAnalyst,
  makeQueueOverview,
  makeTeamOverview,
  makeTeamSummary,
  paula,
  queuedGabriela,
  queuedRosa,
  sebastian,
  seededAnalysts,
  tomas,
} from '@/test/supervision-fixtures'
import {
  ACTIVITY_META,
  HIGH_LOAD_OPEN_CASES,
  QUEUE_LABEL,
  REASSIGNED_NOTICE,
  activityFilterOf,
  analystSheetDescription,
  analystsInFilter,
  analystsOfTeam,
  analystsSummary,
  assignCandidates,
  assignDialogSubtitle,
  assignDialogTitle,
  assignResultCopy,
  assignSubmitLabel,
  assignedToastTitle,
  atRiskCount,
  caseRowLine,
  countByFilter,
  customerSeesCopy,
  describeAssignFailure,
  findCaseSummary,
  isHighLoad,
  languagesLabel,
  longestWait,
  needsPauseConfirmation,
  openCasesCell,
  parseCaseViewSearch,
  parseTeamSearch,
  pausedWarning,
  queueOldestWait,
  queueRiskText,
  queuedNoticeCopy,
  queuedWaitLabel,
  selectedTeam,
  showsNoSessionHint,
  speakersCaption,
  teamPillLabels,
  teamSubtitle,
  toCaseViewSearch,
  toReplyCount,
  toTeamSearch,
  unchangedToastTitle,
  waitSince,
  RECENT_RATING_HEADER,
  formatRatingAverage,
  recentRatingCell,
} from './model'

describe('"Ahora" (contract §2.2)', () => {
  it('labels and tones every activity like the canvas', () => {
    expect(ACTIVITY_META).toEqual({
      busy: { label: 'Atendiendo', tone: 'success' },
      available: { label: 'Disponible', tone: 'accent' },
      paused: { label: 'En pausa', tone: 'warn' },
      offline: { label: 'Sin conexión', tone: 'neutral' },
    })
  })

  it('hints "sin sesión abierta" only for someone available without a session', () => {
    expect(showsNoSessionHint(daniela)).toBe(true)
    expect(showsNoSessionHint({ ...daniela, signedIn: true })).toBe(false)
    expect(showsNoSessionHint({ activity: 'available', signedIn: false })).toBe(true)
    expect(showsNoSessionHint(julian)).toBe(false)
    expect(showsNoSessionHint(paula)).toBe(false)
  })
})

describe('team and activity filters', () => {
  it('groups busy and available as Conectadas', () => {
    expect(activityFilterOf('busy')).toBe('connected')
    expect(activityFilterOf('available')).toBe('connected')
    expect(activityFilterOf('paused')).toBe('paused')
    expect(activityFilterOf('offline')).toBe('offline')
  })

  it('counts each filter after the team filter (seed §9.4)', () => {
    expect(countByFilter(seededAnalysts)).toEqual({ connected: 1, paused: 1, offline: 4 })
    const andes = analystsOfTeam(seededAnalysts, ANDES.id)
    expect(andes.map((a) => a.name)).toEqual(['Daniela Ríos', 'Julián Ortega', 'Felipe Echeverri'])
    expect(countByFilter(andes)).toEqual({ connected: 1, paused: 1, offline: 1 })
    expect(analystsOfTeam(seededAnalysts, null)).toHaveLength(6)
    expect(analystsInFilter(seededAnalysts, 'offline').map((a) => a.name)).toEqual([
      'Felipe Echeverri',
      'Paula Medina',
      'Sebastián Cárdenas',
      'Tomás Arango',
    ])
  })

  it('resolves the selected team by id, unknown ids (old slugs too) meaning all', () => {
    const { teams } = makeTeamOverview()
    expect(selectedTeam(teams, ANDES.id)?.name).toBe('Equipo Andes')
    expect(selectedTeam(teams, 'disputas-equipo-andes')).toBeNull()
    expect(selectedTeam(teams, null)).toBeNull()
  })

  it('drops the prefix every team shares from the pills', () => {
    const { teams } = makeTeamOverview()
    expect(teamPillLabels(teams)).toEqual({
      [ANDES.id]: 'Equipo Andes',
      [PACIFICO.id]: 'Equipo Pacífico',
    })
    const cobranzas = 'TEAM-00000000000000000000000009'
    const mixed = [...teams, makeTeamSummary({ id: cobranzas, name: 'Cobranzas' })]
    expect(teamPillLabels(mixed)[cobranzas]).toBe('Cobranzas')
    expect(teamPillLabels(mixed)[ANDES.id]).toBe('Equipo Andes')
  })

  it('writes the subtitle', () => {
    expect(teamSubtitle(null, 6)).toBe('Todos los equipos · 6 analistas')
    expect(teamSubtitle(makeTeamSummary(), 1)).toBe('Equipo Andes · 1 analista')
  })
})

describe('analyst figures at a pinned now', () => {
  it('computes the SLA at risk and the longest wait from the rows', () => {
    expect(atRiskCount(daniela.openCases, NOW)).toBe(1) // Beatriz, 3 min left
    expect(atRiskCount(julian.openCases, NOW)).toBe(1) // Camila, overdue
    expect(atRiskCount(seededInbox, minutesFrom(-60))).toBe(0)
    expect(longestWait(daniela, NOW)).toBe('4 min')
    expect(longestWait(paula, NOW)).toBe('—')
    expect(waitSince(minutesFrom(-0.5), NOW)).toBe('30 s')
    expect(waitSince(new Date(NOW.getTime() - 4 * 60_000 - 50_000), NOW)).toBe('4 min')
    expect(waitSince(minutesFrom(-65), NOW)).toBe('1 h 05 min')
  })

  it('flags high load from 5 open cases and shows "—" for someone offline and idle', () => {
    expect(HIGH_LOAD_OPEN_CASES).toBe(5)
    expect(isHighLoad(daniela)).toBe(true)
    expect(isHighLoad(julian)).toBe(false)
    expect(openCasesCell(daniela)).toBe('5')
    expect(openCasesCell(paula)).toBe('—')
    expect(openCasesCell({ ...paula, activity: 'paused' })).toBe('0')
    expect(toReplyCount(daniela)).toBe(4)
    expect(toReplyCount(julian)).toBe(1)
  })

  it('summarizes the listed analysts', () => {
    expect(analystsSummary(seededAnalysts, NOW)).toBe('7 casos abiertos · 2 en riesgo de SLA')
    expect(analystsSummary([julian], NOW)).toBe('2 casos abiertos · 1 en riesgo de SLA')
    expect(analystsSummary([paula], NOW)).toBe('0 casos abiertos · 0 en riesgo de SLA')
  })

  it('describes an analyst and her case rows', () => {
    expect(languagesLabel(['es', 'pt'])).toBe('español, portugués')
    expect(analystSheetDescription(julian)).toBe('En pausa · español · Equipo Andes')
    expect(caseRowLine(julianCamila)).toBe('Prioridad media · App · español')
  })
})

describe('queues', () => {
  it('words the risk, the oldest wait and the speakers', () => {
    expect(queueRiskText(1)).toBe('1 en riesgo de SLA')
    expect(queueRiskText(0)).toBe('Sin riesgo')
    const [es, pt] = makeQueueOverview().queues
    expect(queueOldestWait(es!, NOW)).toBe('13 min')
    expect(queueOldestWait({ oldestQueuedAt: null }, NOW)).toBe('—')
    expect(atRiskCount(es!.cases, NOW)).toBe(2)
    expect(atRiskCount(pt!.cases, NOW)).toBe(0)
    expect(speakersCaption(1, 'es')).toBe('disponible que habla español')
    expect(speakersCaption(0, 'pt')).toBe('disponibles que hablan portugués')
    expect(queuedWaitLabel(queuedRosa, NOW)).toBe('Espera 13 min')
  })

  it('pins the queue labels to the backend text', () => {
    expect(QUEUE_LABEL).toEqual({ es: 'Cola en español', pt: 'Cola en portugués' })
  })

  it('finds a case in the cached overviews', () => {
    const team = makeTeamOverview()
    const queues = makeQueueOverview()
    expect(findCaseSummary(queuedGabriela.id, team, queues)).toBe(queuedGabriela)
    expect(findCaseSummary(julianCamila.id, team, queues)).toBe(julianCamila)
    expect(findCaseSummary('CASE-NOPE', team, queues)).toBeNull()
    expect(findCaseSummary(julianCamila.id, undefined, undefined)).toBeNull()
  })
})

describe('assign dialog (contract §8.6)', () => {
  it('titles and describes a queued case and a held one', () => {
    expect(assignDialogTitle(queuedRosa)).toBe('Asignar caso')
    expect(assignDialogTitle(julianCamila)).toBe('Reasignar caso')
    expect(assignDialogSubtitle(queuedRosa, null, NOW)).toBe(
      'Rosa Elena Ibarra Méndez · CASE-…0111 · español · Espera 13 min en la cola',
    )
    expect(assignDialogSubtitle(julianCamila, 'Julián Ortega', NOW)).toBe(
      'Camila Torres Benavides · CASE-…0113 · español · Lo atiende Julián Ortega',
    )
  })

  it('lists speakers first, then by activity, load and name; non-speakers disabled (rule 3)', () => {
    const candidates = assignCandidates(seededAnalysts, queuedGabriela)
    expect(candidates.map((c) => [c.label, c.disabled])).toEqual([
      ['Daniela Ríos', false],
      ['Sebastián Cárdenas', false],
      ['Tomás Arango', false],
      ['Julián Ortega', true],
      ['Felipe Echeverri', true],
      ['Paula Medina', true],
    ])
    expect(candidates[0]?.description).toBe('Atendiendo · 5 abiertos · español, portugués')
    expect(candidates[1]?.description).toBe('Sin conexión · 0 abiertos · español, portugués')
    expect(candidates[3]?.description).toBe('No habla portugués (regla 3)')
  })

  it('puts available before busy and fewer open cases first', () => {
    const free = makeAnalyst({
      id: 'STF-X',
      name: 'Ana Zea',
      activity: 'available',
      languages: ['es'],
    })
    const order = assignCandidates([julian, daniela, free, paula], queuedRosa).map((c) => c.label)
    expect(order).toEqual(['Ana Zea', 'Daniela Ríos', 'Julián Ortega', 'Paula Medina'])
  })

  it('never offers the current assignee', () => {
    const labels = assignCandidates(seededAnalysts, julianCamila).map((c) => c.value)
    expect(labels).not.toContain(JULIAN_ID)
    expect(labels).toContain(DANIELA_ID)
  })

  it('asks to confirm a paused or offline target', () => {
    expect(needsPauseConfirmation(julian)).toBe(true)
    expect(needsPauseConfirmation(sebastian)).toBe(true)
    expect(needsPauseConfirmation(daniela)).toBe(false)
    expect(pausedWarning(julian)).toBe(
      'Julián está en pausa: no recibe casos nuevos. Si lo asignas igual, le llega a su lista.',
    )
    expect(pausedWarning(sebastian)).toBe(
      'Sebastián está en pausa: no recibe casos nuevos. Si lo asignas igual, le llega a su lista. Tampoco tiene una sesión abierta.',
    )
  })

  it('pins the reassignment notice to the backend text', () => {
    expect(REASSIGNED_NOTICE.es('Daniela')).toBe('Ahora te atiende Daniela, de nuestro equipo.')
    expect(REASSIGNED_NOTICE.pt('Daniela')).toBe('Agora quem te atende é Daniela, da nossa equipe.')
  })

  it('previews what the customer sees', () => {
    expect(customerSeesCopy(queuedRosa, daniela)).toBe('Que ya lo atiende Daniela.')
    expect(customerSeesCopy(julianCamila, daniela)).toBe(
      'Ahora te atiende Daniela, de nuestro equipo.',
    )
    expect(customerSeesCopy({ ...julianCamila, language: 'pt' }, tomas)).toBe(
      'Agora quem te atende é Tomás, da nossa equipe.',
    )
  })

  it('labels the submit button', () => {
    expect(assignSubmitLabel(queuedRosa, daniela)).toBe('Asignar a Daniela')
    expect(assignSubmitLabel(julianCamila, daniela)).toBe('Reasignar a Daniela')
    expect(assignSubmitLabel(julianCamila, null)).toBe('Reasignar')
  })

  it('maps every failure code to copy and a follow-up', () => {
    const ctx = { caseLanguage: 'pt' as const, analystName: 'Julián Ortega' }
    const problem = (status: number, code: string, extensions = {}) =>
      new ApiProblem({ status, code, extensions })
    expect(
      describeAssignFailure(problem(422, 'language_mismatch', { caseLanguage: 'pt' }), ctx),
    ).toEqual({
      message: 'Ese caso es en portugués y Julián no lo habla (regla 3).',
      action: 'none',
    })
    expect(describeAssignFailure(problem(409, 'analyst_paused'), ctx)).toEqual({
      message: 'Julián está en pausa. Marca «Asignar aunque esté en pausa» para seguir.',
      action: 'confirm_paused',
    })
    expect(describeAssignFailure(problem(409, 'assignment_changed'), ctx)).toEqual({
      message: 'Alguien más movió este caso mientras decidías. Revisa a quién está asignado ahora.',
      action: 'refetch',
    })
    expect(describeAssignFailure(problem(409, 'case_closed'), ctx)).toEqual({
      message: 'Este caso ya se cerró.',
      action: 'close',
    })
    expect(describeAssignFailure(problem(422, 'analyst_not_eligible'), ctx)).toEqual({
      message: 'Esa persona ya no puede recibir casos.',
      action: 'refetch_team',
    })
    expect(describeAssignFailure(ApiProblem.network(), ctx)).toEqual({
      message: 'No pudimos asignar el caso. Inténtalo de nuevo.',
      action: 'none',
    })
  })
})

describe('after an assignment', () => {
  it('writes the result strip for the queue and for a reassignment', () => {
    expect(
      assignResultCopy({
        customerName: 'Gabriela Duarte Melo',
        analystName: 'Sebastián Cárdenas',
        previousAnalystName: null,
        queueLanguage: 'pt',
        queueRemaining: 0,
      }),
    ).toEqual({
      prefix: 'Listo ·',
      message:
        'El caso de Gabriela Duarte Melo pasó a Sebastián Cárdenas. La cola en portugués quedó en 0.',
    })
    expect(
      assignResultCopy({
        customerName: 'Camila Torres Benavides',
        analystName: 'Daniela Ríos',
        previousAnalystName: 'Julián Ortega',
        queueLanguage: 'es',
        queueRemaining: 2,
      }).message,
    ).toBe('El caso de Camila Torres Benavides pasó de Julián Ortega a Daniela Ríos.')
  })

  it('titles the success and no-op toasts', () => {
    expect(assignedToastTitle('Camila Torres Benavides', 'Daniela Ríos')).toBe(
      'Listo · El caso de Camila Torres Benavides pasó a Daniela Ríos',
    )
    expect(unchangedToastTitle('Daniela Ríos')).toBe('Daniela ya tenía este caso.')
  })
})

describe('supervisor notice', () => {
  it('words the queued-case toast without AI or approval wording', () => {
    expect(queuedNoticeCopy(queuedGabriela)).toEqual({
      tag: 'Cola en portugués',
      title: 'Un caso espera en la cola en portugués',
      description: 'Gabriela Duarte Melo · nadie disponible habla portugués',
    })
  })
})

describe('URL state', () => {
  it('parses and serializes the team screen, unknown values falling back', () => {
    const state = parseTeamSearch(
      new URLSearchParams(`equipo=${ANDES.id}&estado=en-pausa&analista=STF-1&asignar=CASE-1`),
    )
    expect(state).toEqual({
      team: ANDES.id,
      activity: 'paused',
      analystId: 'STF-1',
      assignCaseId: 'CASE-1',
    })
    expect(toTeamSearch(state).toString()).toBe(
      `equipo=${ANDES.id}&estado=en-pausa&analista=STF-1&asignar=CASE-1`,
    )
    const fallback = parseTeamSearch(new URLSearchParams('estado=vacaciones&analista=%20'))
    expect(fallback).toEqual({
      team: null,
      activity: 'connected',
      analystId: null,
      assignCaseId: null,
    })
    expect(toTeamSearch(fallback).toString()).toBe('')
    expect(toTeamSearch({ ...fallback, activity: 'offline' }).toString()).toBe(
      'estado=desconectadas',
    )
  })

  it('parses and serializes the case view', () => {
    expect(parseCaseViewSearch(new URLSearchParams('historial=lista&asignar=1'))).toEqual({
      history: 'lista',
      assign: true,
    })
    expect(parseCaseViewSearch(new URLSearchParams('asignar=si'))).toEqual({
      history: null,
      assign: false,
    })
    expect(toCaseViewSearch({ history: 'CASE-9', assign: true }).toString()).toBe(
      'historial=CASE-9&asignar=1',
    )
    expect(toCaseViewSearch({ history: null, assign: false }).toString()).toBe('')
  })
})

describe('fixture sanity', () => {
  it('keeps Felipe and Paula as Spanish-only analysts', () => {
    expect(felipe.languages).toEqual(['es'])
    expect(paula.languages).toEqual(['es'])
  })
})

describe('"Calificación 7 días" (slice 7)', () => {
  it('shows the face of the average, one decimal with a comma, and the count', () => {
    expect(recentRatingCell({ count: 9, average: 32 / 9 })).toEqual({
      icon: 'laugh',
      tone: 'success',
      average: '3,6',
      count: '(9)',
      tooltip: 'Promedio 3,6 de 4 en 9 casos calificados',
    })
    expect(recentRatingCell({ count: 1, average: 2 })).toEqual({
      icon: 'meh',
      tone: 'danger',
      average: '2,0',
      count: '(1)',
      tooltip: 'Promedio 2,0 de 4 en 1 caso calificado',
    })
    expect(recentRatingCell({ count: 6, average: 2.7 })?.tone).toBe('warn')
    expect(recentRatingCell({ count: 6, average: 2.7 })?.icon).toBe('smile')
    expect(recentRatingCell({ count: 4, average: 1.2 })?.icon).toBe('frown')
  })

  it('is empty ("—") when nothing was rated', () => {
    expect(recentRatingCell({ count: 0, average: null })).toBeNull()
    expect(formatRatingAverage(3)).toBe('3,0')
    expect(formatRatingAverage(3.25)).toBe('3,3')
    expect(RECENT_RATING_HEADER.label).toBe('Calificación 7 días')
  })
})
