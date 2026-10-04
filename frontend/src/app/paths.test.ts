import { describe, expect, it } from 'vitest'
import {
  adminAuditPath,
  adminTeamPath,
  adminUserPath,
  PATHS,
  supervisionAnalystPath,
  supervisionCasePath,
  supervisionEscalationPath,
  supervisionQueuesPath,
  workspacePath,
} from './paths'

describe('paths', () => {
  it('serves English paths only', () => {
    const all = JSON.stringify(PATHS)
    expect(all).not.toMatch(
      /analista|colas|equipo|escalados|casos|auditoria|administracion|usuarios|cliente|activar|restablecer|correos|verificacion|bloqueada/,
    )
  })

  it('builds the Workspace path with a case and a filter', () => {
    expect(workspacePath()).toBe('/analyst/cases')
    expect(workspacePath({ status: 'closed' })).toBe('/analyst/cases?status=closed')
    expect(workspacePath({ caseId: 'CASE-1', status: 'to_reply' })).toBe(
      '/analyst/cases?case=CASE-1&status=to_reply',
    )
    expect(workspacePath({ caseId: 'CASE-1', status: null })).toBe('/analyst/cases?case=CASE-1')
  })

  it('builds the supervision paths', () => {
    expect(supervisionCasePath('CASE-1')).toBe('/supervision/cases/CASE-1')
    expect(supervisionAnalystPath('STF-1')).toBe('/supervision/team?analyst=STF-1')
    expect(supervisionEscalationPath('ESC-1')).toBe('/supervision/escalations?escalation=ESC-1')
    expect(supervisionEscalationPath(null)).toBe('/supervision/escalations')
    expect(supervisionQueuesPath('es')).toBe('/supervision/queues')
    expect(supervisionQueuesPath('pt')).toBe('/supervision/queues?language=pt')
  })

  it('builds the administration paths', () => {
    expect(adminUserPath('STF-1')).toBe('/admin/users?person=STF-1')
    expect(adminTeamPath('TEAM-1')).toBe('/admin/teams?team=TEAM-1')
    expect(adminAuditPath('STF-1')).toBe('/admin/audit?q=STF-1')
  })
})
