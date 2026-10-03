import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createEnvelopeHandlerRegistry, type RealtimeEnvelope } from '@/lib/realtime'
import {
  daniela,
  makeTeamDetail,
  makeTeamList,
  makeUserList,
  teamPacifico,
} from '@/test/admin-fixtures'
import { NOW } from '@/test/case-fixtures'
import { adminKeys } from './api'
import { readDirectoryUpdate, registerAdminRealtime } from './realtime'

let counter = 0
function directoryUpdated(payload: unknown): RealtimeEnvelope {
  counter += 1
  return {
    type: 'directory.updated',
    id: `EVT-D${counter}`,
    occurredAt: NOW.toISOString(),
    data: { entity: 'staff', entityId: 'STF-1', caseId: null, actor: null, payload },
  }
}

function setup() {
  const registry = createEnvelopeHandlerRegistry()
  registerAdminRealtime(registry)
  const queryClient = new QueryClient()
  queryClient.setQueryData(adminKeys.userList({}), makeUserList())
  queryClient.setQueryData(adminKeys.userList({ status: 'inactive' }), makeUserList([]))
  queryClient.setQueryData(adminKeys.user(daniela.id), daniela)
  queryClient.setQueryData(adminKeys.user('STF-OTHER'), daniela)
  queryClient.setQueryData(adminKeys.teamList('active'), makeTeamList())
  queryClient.setQueryData(adminKeys.team(teamPacifico.id), makeTeamDetail(teamPacifico, []))
  queryClient.setQueryData(adminKeys.team('TEAM-OTHER'), makeTeamDetail())
  const invalidated = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated ?? false
  return { registry, queryClient, invalidated }
}

describe('registerAdminRealtime', () => {
  it('reads the ids of directory.updated (missing lists are empty)', () => {
    expect(readDirectoryUpdate(directoryUpdated({ staffIds: ['STF-1', 3], teamIds: [] }))).toEqual({
      staffIds: ['STF-1'],
      teamIds: [],
    })
    expect(readDirectoryUpdate(directoryUpdated(null))).toEqual({ staffIds: [], teamIds: [] })
  })

  it('a staff change invalidates every list, that person and every team detail', () => {
    const { registry, queryClient, invalidated } = setup()
    expect(
      registry.dispatch(directoryUpdated({ staffIds: [daniela.id], teamIds: [] }), queryClient),
    ).toBe(1)
    expect(invalidated(adminKeys.userList({}))).toBe(true)
    expect(invalidated(adminKeys.userList({ status: 'inactive' }))).toBe(true)
    expect(invalidated(adminKeys.user(daniela.id))).toBe(true)
    expect(invalidated(adminKeys.user('STF-OTHER'))).toBe(false)
    expect(invalidated(adminKeys.teamList('active'))).toBe(true)
    // Memberships may have moved: every team detail refetches.
    expect(invalidated(adminKeys.team('TEAM-OTHER'))).toBe(true)
  })

  it('a team change invalidates the lists and only the named team', () => {
    const { registry, queryClient, invalidated } = setup()
    registry.dispatch(directoryUpdated({ staffIds: [], teamIds: [teamPacifico.id] }), queryClient)
    expect(invalidated(adminKeys.team(teamPacifico.id))).toBe(true)
    expect(invalidated(adminKeys.team('TEAM-OTHER'))).toBe(false)
    expect(invalidated(adminKeys.user(daniela.id))).toBe(false)
    expect(invalidated(adminKeys.teamList('active'))).toBe(true)
    expect(invalidated(adminKeys.userList({}))).toBe(true)
  })
})
