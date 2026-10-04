import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { NOW, minutesFrom, seededInbox } from '@/test/case-fixtures'
import {
  ANDES,
  JULIAN_ID,
  LUCIA_ID,
  PACIFICO,
  answeredEscalation,
  camilaEscalation,
  daniela,
  felipe,
  julian,
  julianCamila,
  makeAnalyst,
  makeEscalation,
  makeOpenCases,
  makeTeamOverview,
  marcelaEscalation,
  paula,
  queuedMauricio,
  queuedRosa,
  seededAnalysts,
  sebastian,
  tomas,
} from '@/test/supervision-fixtures'
import {
  ACTIVITY_META,
  AUTOMATIC_ASSIGNMENT_NOTE,
  CONFIRM_PAUSED_LABEL,
  HIGH_LOAD_OPEN_CASES,
  QUEUE_LABEL,
  REASSIGNED_NOTICE,
  RECENT_RATING_HEADER,
  analystsFigures,
  atRiskCount,
  backLabelFor,
  customerSeesCopy,
  describeAssignFailure,
  describeEscalationFailure,
  escalatedAgo,
  escalationCaseFacts,
  escalationGroups,
  escalationOutcomeTitle,
  escalationResultCopy,
  filterAnalysts,
  filterOpenCases,
  findOpenCase,
  firstResponseFact,
  foldText,
  formatRatingAverage,
  isHighLoad,
  longestWait,
  moreResultsLabel,
  needsPauseConfirmation,
  noMatchCopy,
  openCaseStatus,
  openCasesCell,
  openEscalationsLabel,
  pausedWarning,
  presenceTone,
  queueFiguresFromRows,
  queueFilterGroups,
  queueNavLabels,
  queuesStateFromSelection,
  reassignList,
  reassignPool,
  reassignResultCopy,
  reassignSubmitLabel,
  recentRatingCell,
  replyHelp,
  replyLabel,
  shownCasesLabel,
  showsNoSessionHint,
  teamFilterGroups,
  teamStateFromSelection,
  teamSubtitle,
  toReplyCount,
  unchangedToastTitle,
  waitSince,
} from './model'
import type { QueuesUrlState, TeamUrlState } from './url'

const QUEUES: QueuesUrlState = { language: 'es', statuses: [], priorities: [], analysts: [] }
const TEAM: TeamUrlState = {
  activities: [],
  languages: [],
  teams: [],
  analystId: null,
  reassignCaseId: null,
}

describe('"Ahora"', () => {
  it('draws every activity with the dot language and gender-neutral words', () => {
    expect(ACTIVITY_META).toEqual({
      busy: { shape: 'dot', tone: 'success', label: 'Atendiendo' },
      available: { shape: 'ring', tone: 'success', label: 'Disponible' },
      paused: { shape: 'pause', tone: 'warn', label: 'En pausa' },
      offline: { shape: 'ring', tone: 'neutral', label: 'Sin conexión' },
    })
    expect(presenceTone('busy')).toBe('success')
    expect(presenceTone('paused')).toBe('warn')
    expect(presenceTone('offline')).toBe('offline')
  })

  it('hints "sin sesión abierta" only for someone available without a session', () => {
    expect(showsNoSessionHint(daniela)).toBe(true)
    expect(showsNoSessionHint(julian)).toBe(false)
    expect(showsNoSessionHint({ activity: 'available', signedIn: true })).toBe(false)
  })
})

describe('analyst figures at a pinned now', () => {
  it('computes the SLA at risk and the longest wait from the rows', () => {
    expect(atRiskCount(daniela.openCases, NOW)).toBe(1)
    expect(atRiskCount(julian.openCases, NOW)).toBe(1)
    expect(longestWait(daniela, NOW)).toBe('4 min')
    expect(longestWait(paula, NOW)).toBe('—')
    expect(waitSince(minutesFrom(-0.5), NOW)).toBe('30 s')
    expect(waitSince(minutesFrom(-65), NOW)).toBe('1 h 05 min')
  })

  it('flags high load and shows "—" for someone offline and idle', () => {
    expect(HIGH_LOAD_OPEN_CASES).toBe(5)
    expect(isHighLoad(daniela)).toBe(true)
    expect(openCasesCell(paula)).toBe('—')
    expect(openCasesCell({ ...paula, activity: 'paused' })).toBe('0')
    expect(toReplyCount(daniela)).toBe(4)
  })

  it('sums the listed analysts without a dot-joined line', () => {
    expect(analystsFigures(seededAnalysts, NOW)).toEqual({ open: '7 casos abiertos', atRisk: 2 })
    expect(analystsFigures([julian], NOW)).toEqual({ open: '2 casos abiertos', atRisk: 1 })
  })
})

describe('"Colas"', () => {
  const rows = makeOpenCases().cases

  it('explains that assignment is automatic', () => {
    expect(AUTOMATIC_ASSIGNMENT_NOTE).toBe(
      'La asignación es automática: cada caso le llega a la primera persona disponible que habla su idioma.',
    )
    expect(QUEUE_LABEL).toEqual({ es: 'Cola en español', pt: 'Cola en portugués' })
  })

  it('counts open, unassigned and at-risk cases from the rows', () => {
    const figures = queueFiguresFromRows(rows, NOW)
    expect(figures).toEqual({ open: rows.length, unassigned: 2, atRisk: 4 })
    expect(queueNavLabels(figures)).toEqual({
      open: `${rows.length} abiertos`,
      unassigned: '2 sin asignar',
      atRisk: '4 en riesgo',
    })
    expect(queueNavLabels({ open: 1, unassigned: 0, atRisk: 0 }).open).toBe('1 abierto')
    expect(shownCasesLabel(2, 9, true)).toBe('2 de 9 casos abiertos')
    expect(shownCasesLabel(1, 1, false)).toBe('1 caso abierto')
  })

  it('says "Sin asignar" while nobody holds a case', () => {
    expect(openCaseStatus(queuedRosa)).toEqual({
      shape: 'dashed',
      tone: 'neutral',
      label: 'Sin asignar',
    })
    expect(openCaseStatus(julianCamila)).toMatchObject({ shape: 'pie-75', label: 'Por responder' })
  })

  it('shows the first response as flame, clock or "Respondida"', () => {
    expect(firstResponseFact(queuedMauricio, NOW)).toMatchObject({
      icon: 'flame-filled',
      tone: 'danger',
      text: 'Vencida',
      tooltip: 'Primera respuesta vencida',
    })
    expect(firstResponseFact(queuedRosa, NOW)).toMatchObject({
      icon: 'flame',
      tone: 'warn',
      text: '2 min',
      tooltip: 'Primera respuesta: vence en 2 min',
    })
    expect(firstResponseFact({ ...queuedRosa, slaDueAt: minutesFrom(14) }, NOW)).toMatchObject({
      icon: 'clock',
      text: '14 min',
    })
    expect(firstResponseFact(seededInbox[1]!, NOW)).toMatchObject({
      icon: 'check',
      text: 'Respondida',
    })
  })

  it('filters by status, priority and analyst (OR in a group, AND across)', () => {
    const unassigned = filterOpenCases(rows, { ...QUEUES, statuses: ['queued'] })
    expect(unassigned.map((row) => row.case.id)).toEqual([queuedRosa.id, queuedMauricio.id])
    const julianToReply = filterOpenCases(rows, {
      ...QUEUES,
      statuses: ['to_reply', 'new'],
      analysts: [JULIAN_ID],
    })
    expect(julianToReply.map((row) => row.case.id)).toEqual([julianCamila.id])
    const high = filterOpenCases(rows, { ...QUEUES, priorities: ['high'] })
    expect(high.map((row) => row.case.id)).toEqual([queuedMauricio.id])
  })

  it('offers faceted counts in the Filtros groups', () => {
    const groups = queueFilterGroups(rows, { ...QUEUES, analysts: [JULIAN_ID] })
    expect(groups.map((group) => group.legend)).toEqual(['Estado', 'Prioridad', 'Analista'])
    const estado = groups[0]!.options
    expect(estado.map((o) => [o.label, o.count])).toEqual([
      ['Sin asignar', 0],
      ['Nuevo', 0],
      ['Por responder', 1],
      ['Esperando al cliente', 1],
    ])
    const analysts = groups[2]!.options
    expect(analysts.map((o) => o.label)).toEqual(['Daniela Ríos', 'Julián Ortega'])
    expect(analysts.find((o) => o.value === JULIAN_ID)?.count).toBe(2)
  })

  it('maps the "Filtros" selection back to the URL state', () => {
    expect(
      queuesStateFromSelection(QUEUES, { status: ['new', 'bogus'], priority: ['low'] }),
    ).toEqual({ ...QUEUES, statuses: ['new'], priorities: ['low'] })
  })
})

describe('"Equipo"', () => {
  const overview = makeTeamOverview()

  it('filters by state, language and team, with faceted counts', () => {
    const groups = teamFilterGroups(overview, TEAM)
    expect(groups.map((group) => group.legend)).toEqual(['Estado', 'Idioma', 'Equipo'])
    expect(groups[0]!.options.map((o) => [o.label, o.count])).toEqual([
      ['Atendiendo', 1],
      ['Disponible', 0],
      ['En pausa', 1],
      ['Sin conexión', 4],
    ])
    expect(groups[1]!.options.map((o) => [o.label, o.count])).toEqual([
      ['Español', 6],
      ['Portugués', 3],
    ])
    expect(groups[2]!.options.map((o) => o.label)).toEqual(['Equipo Andes', 'Equipo Pacífico'])
    const pt = filterAnalysts(seededAnalysts, { ...TEAM, languages: ['pt'] })
    expect(pt.map((a) => a.name)).toEqual(['Daniela Ríos', 'Sebastián Cárdenas', 'Tomás Arango'])
    const ptPacifico = filterAnalysts(seededAnalysts, {
      ...TEAM,
      languages: ['pt'],
      teams: [PACIFICO.id],
    })
    expect(ptPacifico.map((a) => a.name)).toEqual(['Sebastián Cárdenas', 'Tomás Arango'])
    const faceted = teamFilterGroups(overview, { ...TEAM, teams: [ANDES.id] })
    expect(faceted[1]!.options.map((o) => o.count)).toEqual([3, 1])
    expect(teamSubtitle(2, 6, true)).toBe('2 de 6 analistas')
    expect(teamSubtitle(6, 6, false)).toBe('6 analistas')
  })

  it('maps the "Filtros" selection back to the URL state and finds an open case', () => {
    expect(
      teamStateFromSelection(TEAM, { status: ['offline', 'x'], language: ['pt', 'en'] }),
    ).toEqual({ ...TEAM, activities: ['offline'], languages: ['pt'] })
    expect(findOpenCase(julianCamila.id, overview)?.id).toBe(julianCamila.id)
    expect(findOpenCase(queuedRosa.id, overview)).toBeNull()
  })
})

describe('reassign dialog', () => {
  const connected = (name: string, open: number, activity: 'busy' | 'available' = 'busy') =>
    makeAnalyst({
      id: `STF-${name}`,
      name,
      activity,
      availability: 'available',
      counts: { open, new: 0, toReply: 0, waiting: 0 },
    })
  const team = [
    connected('Ana Ruiz', 3),
    connected('Bruno Díaz', 1),
    connected('Carla Gil', 0, 'available'),
    connected('Dario Paz', 2),
    connected('Elena Mora', 4),
    connected('Fabio Sol', 5),
    connected('Gina Luz', 6),
    julian,
    sebastian,
  ]

  it('offers only speakers of the case language, never the holder, the least loaded first', () => {
    const pool = reassignPool(team, julianCamila, { includeAway: false })
    expect(pool.map((a) => a.name)).toEqual([
      'Carla Gil',
      'Bruno Díaz',
      'Dario Paz',
      'Ana Ruiz',
      'Elena Mora',
      'Fabio Sol',
      'Gina Luz',
    ])
    const withAway = reassignPool(team, julianCamila, { includeAway: true })
    expect(withAway.at(-1)?.name).toBe('Sebastián Cárdenas')
    expect(withAway.some((a) => a.id === JULIAN_ID)).toBe(false) // the holder
    const portuguese = reassignPool(
      [...team, tomas],
      { language: 'pt', assignedAnalystId: null },
      {
        includeAway: true,
      },
    )
    expect(portuguese.map((a) => a.name)).toEqual(['Sebastián Cárdenas', 'Tomás Arango'])
  })

  it('suggests three, searches up to six (accents ignored) and keeps the chosen one', () => {
    const pool = reassignPool(team, julianCamila, { includeAway: false })
    const suggested = reassignList(pool, '', null)
    expect(suggested.title).toBe('Sugeridos')
    expect(suggested.shown.map((a) => a.name)).toEqual(['Carla Gil', 'Bruno Díaz', 'Dario Paz'])
    expect(suggested.hidden).toBe(4)
    expect(moreResultsLabel(4)).toBe('+4 más: escribe un nombre para encontrarlos')
    expect(moreResultsLabel(0)).toBeNull()
    const results = reassignList(pool, 'a', null)
    expect(results.title).toBe('Resultados')
    expect(results.shown).toHaveLength(6)
    expect(reassignList(pool, 'DIAZ', null).shown.map((a) => a.name)).toEqual(['Bruno Díaz'])
    expect(reassignList(pool, '', 'STF-Gina Luz').shown.at(-1)?.name).toBe('Gina Luz')
    expect(reassignList(pool, 'zzz', null).shown).toEqual([])
    expect(noMatchCopy('pt')).toBe('Nadie con ese nombre habla portugués.')
    expect(foldText('Julián')).toBe('julian')
  })

  it('asks to confirm a paused or offline choice and previews the customer notice', () => {
    expect(needsPauseConfirmation(julian)).toBe(true)
    expect(needsPauseConfirmation(daniela)).toBe(false)
    expect(CONFIRM_PAUSED_LABEL).toBe('Pasarlo aunque esté en pausa')
    expect(pausedWarning(julian)).toBe(
      'Julián está en pausa: no recibe casos nuevos. Si se lo pasas igual, le llega a su lista.',
    )
    expect(pausedWarning(paula)).toMatch(/Tampoco tiene una sesión abierta\.$/)
    expect(REASSIGNED_NOTICE.es('Daniela')).toBe('Ahora te atiende Daniela, de nuestro equipo.')
    expect(REASSIGNED_NOTICE.pt('Tomás')).toBe('Agora quem te atende é Tomás, da nossa equipe.')
    expect(customerSeesCopy(julianCamila, daniela)).toBe(
      'Ahora te atiende Daniela, de nuestro equipo.',
    )
    expect(reassignSubmitLabel(daniela)).toBe('Reasignar a Daniela')
    expect(reassignSubmitLabel(null)).toBe('Reasignar')
  })

  it('maps every failure code to copy and a follow-up', () => {
    const ctx = { caseLanguage: 'pt' as const, analystName: 'Julián Ortega' }
    const problem = (status: number, code: string, extensions = {}) =>
      new ApiProblem({ status, code, extensions })
    expect(describeAssignFailure(problem(422, 'language_mismatch'), ctx).message).toBe(
      'Ese caso es en portugués y Julián no lo habla (regla 3).',
    )
    expect(describeAssignFailure(problem(409, 'analyst_paused'), ctx)).toEqual({
      message: 'Julián está en pausa. Marca «Pasarlo aunque esté en pausa» para seguir.',
      action: 'confirm_paused',
    })
    expect(describeAssignFailure(problem(409, 'assignment_changed'), ctx).action).toBe('refetch')
    expect(describeAssignFailure(problem(409, 'case_closed'), ctx).action).toBe('close')
    expect(describeAssignFailure(problem(422, 'analyst_not_eligible'), ctx).action).toBe(
      'refetch_team',
    )
    expect(describeAssignFailure(ApiProblem.network(), ctx).message).toBe(
      'No pudimos reasignar el caso. Inténtalo de nuevo.',
    )
  })

  it('reports the result', () => {
    expect(
      reassignResultCopy({
        customerName: 'Camila Torres',
        previousAnalystName: 'Julián Ortega',
        analystName: 'Daniela Ríos',
      }).message,
    ).toBe('El caso de Camila Torres pasó de Julián Ortega a Daniela Ríos.')
    expect(unchangedToastTitle('Daniela Ríos')).toBe('Daniela ya tenía este caso.')
  })
})

describe('"Escalados"', () => {
  it('groups open ones (the longest waiting first) and the ones attended today', () => {
    const groups = escalationGroups([marcelaEscalation, answeredEscalation, camilaEscalation], NOW)
    expect(groups.map((g) => g.label)).toEqual(['Abiertos (2)', 'Atendidos hoy'])
    expect(groups[0]!.items.map((i) => i.escalation.id)).toEqual([
      camilaEscalation.escalation.id,
      marcelaEscalation.escalation.id,
    ])
    const withdrawn = {
      ...marcelaEscalation,
      escalation: { ...marcelaEscalation.escalation, state: 'withdrawn' as const },
    }
    expect(escalationGroups([withdrawn], NOW)).toEqual([])
    const yesterday = {
      ...answeredEscalation,
      escalation: { ...answeredEscalation.escalation, resolvedAt: minutesFrom(-60 * 30) },
    }
    expect(escalationGroups([yesterday], NOW)).toEqual([])
    expect(openEscalationsLabel(1)).toBe('1 abierto')
    expect(openEscalationsLabel(2)).toBe('2 abiertos')
  })

  it('says what supervision did, from the viewer side', () => {
    const answered = answeredEscalation.escalation
    expect(escalationOutcomeTitle(answered, LUCIA_ID)).toBe('Respondiste a Daniela')
    expect(escalationOutcomeTitle(answered, 'STF-other')).toBe('Lucía Herrera respondió')
    const taken = makeEscalation({
      state: 'taken',
      resolvedById: LUCIA_ID,
      resolvedByName: 'Lucía Herrera',
    })
    expect(escalationOutcomeTitle(taken, LUCIA_ID)).toBe('Tomaste el caso')
    const moved = makeEscalation({
      state: 'reassigned',
      resolvedById: LUCIA_ID,
      resolvedByName: 'Lucía Herrera',
      reassignedToName: 'Daniela Ríos',
    })
    expect(escalationOutcomeTitle(moved, 'STF-x')).toBe('Lucía Herrera lo reasignó a Daniela Ríos')
    expect(escalationOutcomeTitle(makeEscalation(), LUCIA_ID)).toBeNull()
    expect(escalatedAgo(makeEscalation(), NOW)).toBe('Escaló hace 21 min')
  })

  it('lists the case facts as icon + short value', () => {
    const facts = escalationCaseFacts(
      {
        summary: camilaEscalation.case,
        holderName: 'Julián Ortega',
        customer: { city: 'Bucaramanga', country: 'CO' },
      },
      NOW,
    )
    expect(facts.map((f) => [f.label, f.text])).toEqual([
      ['Lo atiende', 'Julián Ortega'],
      ['Ciudad', 'Bucaramanga, Colombia'],
      ['Idioma', 'Español'],
      ['Canal', 'Chat en la app'],
      ['Prioridad', 'Media'],
      ['Abierto hace', '25 min'],
    ])
  })

  it('words the reply form, the results and the failures', () => {
    const escalation = camilaEscalation.escalation
    expect(replyLabel(escalation)).toBe('Tu respuesta para Julián')
    expect(replyHelp(escalation)).toBe('Le llega a Julián dentro del caso. El cliente no la ve.')
    const item = { analystName: 'Daniela Ríos', customerName: 'Marcela Quintana Pardo' }
    expect(escalationResultCopy('answered', item).message).toBe(
      'Le llegó tu respuesta a Daniela en el caso de Marcela Quintana Pardo.',
    )
    expect(escalationResultCopy('taken', item).message).toBe(
      'Tomaste el caso de Marcela Quintana Pardo. Daniela lo puede leer, pero ya no responder.',
    )
    expect(escalationResultCopy('reassigned', { ...item, toName: 'Tomás Arango' }).message).toBe(
      'El caso de Marcela Quintana Pardo pasó de Daniela Ríos a Tomás Arango.',
    )
    const problem = (code: string) => new ApiProblem({ status: 409, code })
    expect(
      describeEscalationFailure(problem('escalation_not_open'), { caseLanguage: 'es' }),
    ).toEqual({
      message:
        'Este escalamiento ya no está abierto: lo retiraron o alguien de supervisión ya lo atendió.',
      refetch: true,
    })
    expect(
      describeEscalationFailure(problem('analyst_not_eligible'), { caseLanguage: 'es' }).message,
    ).toBe('Para tomar el caso necesitas también el rol de Analista.')
    expect(
      describeEscalationFailure(problem('language_mismatch'), { caseLanguage: 'pt' }).message,
    ).toBe('Ese caso es en portugués y no lo hablas (regla 3).')
  })
})

describe('the case view', () => {
  it('names "Volver" after the screen it came from', () => {
    expect(backLabelFor(null)).toBe('Volver a Colas')
    expect(backLabelFor('/supervision/queues?language=pt')).toBe('Volver a Colas')
    expect(backLabelFor('/supervision/team?analyst=x')).toBe('Volver a Equipo')
    expect(backLabelFor('/supervision/escalations')).toBe('Volver a Escalados')
    expect(backLabelFor('/supervision/audit?case=x')).toBe('Volver a Auditoría')
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
    expect(recentRatingCell({ count: 6, average: 2.7 })?.tone).toBe('warn')
    expect(recentRatingCell({ count: 0, average: null })).toBeNull()
    expect(formatRatingAverage(3.25)).toBe('3,3')
    expect(RECENT_RATING_HEADER.label).toBe('Calificación 7 días')
  })
})

describe('fixture sanity', () => {
  it('keeps Felipe and Paula as Spanish-only analysts', () => {
    expect(felipe.languages).toEqual(['es'])
    expect(paula.languages).toEqual(['es'])
  })
})
