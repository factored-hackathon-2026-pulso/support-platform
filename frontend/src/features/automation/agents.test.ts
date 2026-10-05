import { describe, expect, it } from 'vitest'
import {
  BASE_RELEASE_ID,
  makeAlias,
  makeRelease,
  makeSummary,
  RELEASE_ID,
} from '@/test/automation-fixtures'
import { makeStages } from '@/test/stage-fixtures'
import {
  agentIds,
  agentRow,
  agentRunAppearance,
  agentRunStatus,
  newestFirst,
  promotionTarget,
  rollbackTarget,
  servedTypes,
} from './agents'

describe('the agents', () => {
  it('lists the agents serving a type first, then the ones proposals are for, once each', () => {
    const proposals = [makeSummary(), makeSummary({ proposalId: 'p2', agentId: 'disputas' })]
    expect(agentIds(makeStages(), proposals)).toEqual(['disputas', 'cobros'])
    expect(agentIds(undefined, [])).toEqual([])
  })

  it('says where an agent runs', () => {
    expect(agentRunStatus(makeAlias(), makeAlias({ alias: 'staging' }))).toBe('prod')
    expect(agentRunStatus(null, makeAlias({ alias: 'staging' }))).toBe('staging')
    expect(agentRunStatus(null, null)).toBe('none')
    expect(agentRunStatus(undefined, undefined)).toBe('unknown')
    expect(agentRunAppearance('prod')).toEqual({
      shape: 'check',
      tone: 'success',
      label: 'En producción',
    })
    expect(agentRunAppearance('none').label).toBe('Sin publicar')
  })

  it('builds a row: the types it serves and the version in production', () => {
    const releases = new Map([[BASE_RELEASE_ID, makeRelease()]])
    expect(
      agentRow('disputas', makeStages(), { prod: makeAlias(), staging: null }, releases),
    ).toEqual({
      agentId: 'disputas',
      serves: ['unrecognized_charge'],
      status: 'prod',
      version: '1.0.0',
    })
    expect(servedTypes(makeStages(), 'cobros')).toEqual([])
  })

  it('rolls prod back to the release it was based on, and promotes what staging holds', () => {
    expect(rollbackTarget(makeRelease({ baseReleaseId: 'rel-old' }))).toBe('rel-old')
    expect(rollbackTarget(makeRelease())).toBeNull()
    expect(
      promotionTarget(makeAlias(), makeAlias({ alias: 'staging', releaseId: RELEASE_ID })),
    ).toBe(RELEASE_ID)
    expect(promotionTarget(makeAlias(), makeAlias({ alias: 'staging' }))).toBeNull()
    expect(promotionTarget(null, null)).toBeNull()
    expect(newestFirst([1, 2, 3])).toEqual([3, 2, 1])
  })
})
