import { describe, expect, it } from 'vitest'
import {
  supervisionAnalystPath,
  supervisionEscalationPath,
  supervisionQueuesPath,
} from '@/app/paths'
import {
  parseCaseViewSearch,
  parseEscalationsSearch,
  parseQueuesSearch,
  parseTeamSearch,
  toCaseViewSearch,
  toEscalationsSearch,
  toQueuesSearch,
  toTeamSearch,
  type QueuesUrlState,
  type TeamUrlState,
} from './url'

const QUEUES: QueuesUrlState = { language: 'es', statuses: [], priorities: [], analysts: [] }
const TEAM: TeamUrlState = {
  activities: [],
  languages: [],
  teams: [],
  analystId: null,
  reassignCaseId: null,
}

/** The query string of a link built in app/paths.ts. */
const searchOf = (path: string) => new URL(path, 'http://app').searchParams

describe('"Colas" URL state', () => {
  it('keeps the queue and filters in the URL, with the API values', () => {
    const state: QueuesUrlState = {
      language: 'pt',
      statuses: ['queued', 'to_reply'],
      priorities: ['critical'],
      analysts: ['STF-ANA0000001'],
    }
    const search = toQueuesSearch(state)
    expect(search.toString()).toBe(
      'language=pt&status=queued%2Cto_reply&priority=critical&analyst=STF-ANA0000001',
    )
    expect(parseQueuesSearch(search)).toEqual(state)
    expect(toQueuesSearch(QUEUES).toString()).toBe('')
  })

  it('drops unknown values', () => {
    expect(parseQueuesSearch(new URLSearchParams('language=en&status=nada&priority=x'))).toEqual(
      QUEUES,
    )
  })

  it('reads the links of app/paths.ts', () => {
    expect(supervisionQueuesPath('pt')).toBe('/supervision/queues?language=pt')
    expect(supervisionQueuesPath('es')).toBe('/supervision/queues')
    expect(parseQueuesSearch(searchOf(supervisionQueuesPath('pt'))).language).toBe('pt')
  })
})

describe('"Equipo" URL state', () => {
  it('keeps the filters, the sheet and the dialog in the URL', () => {
    const state: TeamUrlState = {
      activities: ['busy', 'paused'],
      languages: ['pt'],
      teams: ['TEAM-1'],
      analystId: 'STF-1',
      reassignCaseId: 'CASE-1',
    }
    const search = toTeamSearch(state)
    expect(search.toString()).toBe(
      'status=busy%2Cpaused&language=pt&team=TEAM-1&analyst=STF-1&reassign=CASE-1',
    )
    expect(parseTeamSearch(search)).toEqual(state)
    expect(toTeamSearch(TEAM).toString()).toBe('')
    expect(parseTeamSearch(new URLSearchParams('status=conectadas&language=en'))).toEqual(TEAM)
  })

  it('reads the links of app/paths.ts', () => {
    expect(supervisionAnalystPath('STF-1')).toBe('/supervision/team?analyst=STF-1')
    expect(parseTeamSearch(searchOf(supervisionAnalystPath('STF-1'))).analystId).toBe('STF-1')
  })
})

describe('"Escalados" URL state', () => {
  it('keeps the selection in the URL', () => {
    const state = { escalationId: 'ESC-1', reassign: true }
    expect(toEscalationsSearch(state).toString()).toBe('escalation=ESC-1&reassign=1')
    expect(parseEscalationsSearch(toEscalationsSearch(state))).toEqual(state)
    expect(toEscalationsSearch({ escalationId: null, reassign: true }).toString()).toBe('')
  })

  it('reads the links of app/paths.ts', () => {
    expect(supervisionEscalationPath()).toBe('/supervision/escalations')
    expect(parseEscalationsSearch(searchOf(supervisionEscalationPath('ESC-1')))).toEqual({
      escalationId: 'ESC-1',
      reassign: false,
    })
  })
})

describe('case view URL state', () => {
  it('keeps "Casos anteriores" and the dialog in the URL', () => {
    expect(parseCaseViewSearch(new URLSearchParams('previous=list&reassign=1'))).toEqual({
      history: 'list',
      reassign: true,
    })
    expect(toCaseViewSearch({ history: null, reassign: true }).toString()).toBe('reassign=1')
    expect(toCaseViewSearch({ history: 'CASE-1', reassign: false }).toString()).toBe(
      'previous=CASE-1',
    )
  })
})
