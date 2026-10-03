import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isApiProblem } from '@/lib/api'
import { adminKeys } from '../api'
import { describeAdminFailure, readAdminTeam, readAdminUser, type AdminFailure } from '../model'
import type { AdminTeam, AdminTeamDetail, AdminUser } from '../types'

export type FailureTarget = { kind: 'user'; id: string } | { kind: 'team'; id: string }

export interface HandledFailure extends AdminFailure {
  /** The record now (`version_conflict`), already in the cache: reset the draft to it. */
  current: AdminUser | AdminTeam | null
}

/**
 * Applies what the failure copy table says (contract §10.4) to the cache: on
 * `version_conflict` the `current` record replaces the cached one (invalid →
 * refetch), on the other codes the record, the lists or the teams refetch.
 * Returns the message and the field it belongs to.
 */
export function useFailureHandler() {
  const queryClient = useQueryClient()
  return useCallback(
    (error: unknown, target: FailureTarget): HandledFailure => {
      const failure = describeAdminFailure(error, { subject: target.kind })
      const refetchRecord = () => {
        const queryKey =
          target.kind === 'user' ? adminKeys.user(target.id) : adminKeys.team(target.id)
        void queryClient.invalidateQueries({ queryKey, exact: true })
        void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
        void queryClient.invalidateQueries({ queryKey: adminKeys.teams() })
      }
      let current: AdminUser | AdminTeam | null = null
      switch (failure.action) {
        case 'use_current': {
          const raw = isApiProblem(error) ? error.extensions.current : undefined
          if (target.kind === 'user') {
            const user = readAdminUser(raw)
            if (user) queryClient.setQueryData(adminKeys.user(target.id), user)
            current = user
          } else {
            const team = readAdminTeam(raw)
            if (team) {
              queryClient.setQueryData<AdminTeamDetail>(adminKeys.team(target.id), (detail) =>
                detail ? { ...detail, team } : detail,
              )
            }
            current = team
          }
          // Lists (and an invalid `current`) refetch either way.
          if (!current) refetchRecord()
          else void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
          break
        }
        case 'refetch':
          refetchRecord()
          break
        case 'refetch_teams':
          void queryClient.invalidateQueries({ queryKey: adminKeys.teams() })
          break
        default:
          break
      }
      return { ...failure, current }
    },
    [queryClient],
  )
}
