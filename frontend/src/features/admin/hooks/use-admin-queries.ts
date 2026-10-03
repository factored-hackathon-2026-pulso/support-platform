import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { topics, useOnReconnect, useRealtimeSubscription } from '@/lib/realtime'
import { adminKeys, fetchAdminTeam, fetchAdminTeams, fetchAdminUser, fetchAdminUsers } from '../api'
import type {
  AdminTeamDetail,
  AdminTeamList,
  AdminUser,
  AdminUserFilters,
  AdminUserList,
  TeamStatusFilter,
} from '../types'

/**
 * Locks expire on their own (no event says so): the badge and the lists ask
 * again every minute while on screen (contract §10.9).
 */
export const DIRECTORY_REFETCH_MS = 60_000

/** GET /admin/users for a filter set; kept fresh by `directory.updated` (realtime.ts). */
export function useAdminUsers(
  filters: AdminUserFilters,
  { enabled = true }: { enabled?: boolean } = {},
): UseQueryResult<AdminUserList, ApiProblem> {
  return useQuery<AdminUserList, ApiProblem>({
    queryKey: adminKeys.userList(filters),
    queryFn: ({ signal }) => fetchAdminUsers(filters, signal),
    refetchInterval: DIRECTORY_REFETCH_MS,
    enabled,
  })
}

/**
 * One person: seeded from a loaded list when she is in one (no request while it
 * is fresh), GET /admin/users/{id} otherwise (a shared link, a filter that
 * hides her, an inactive person).
 */
export function useAdminUser(staffId: string | null): UseQueryResult<AdminUser, ApiProblem> {
  const queryClient = useQueryClient()
  const fromLists = () => {
    if (!staffId) return undefined
    for (const [key, list] of queryClient.getQueriesData<AdminUserList>({
      queryKey: adminKeys.users(),
    })) {
      const found = list?.items.find((user) => user.id === staffId)
      if (found) return { user: found, updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt }
    }
    return undefined
  }
  return useQuery<AdminUser, ApiProblem>({
    queryKey: adminKeys.user(staffId ?? ''),
    queryFn: ({ signal }) => fetchAdminUser(staffId ?? '', signal),
    enabled: staffId !== null,
    initialData: () => fromLists()?.user,
    initialDataUpdatedAt: () => fromLists()?.updatedAt,
  })
}

/**
 * Re-reads one person now and resolves with her cached record afterwards
 * (contract §3.6): her open cases gate the deactivation and removing Analista
 * or a language, and a cached count must not keep a block after supervision
 * reassigned them (a missed `directory.updated`, a reconnect gap). A failed
 * read leaves the cached record (the server enforces the rule anyway).
 */
export function useReadAdminUserNow(): (staffId: string) => Promise<AdminUser | undefined> {
  const queryClient = useQueryClient()
  return useCallback(
    async (staffId: string) => {
      await queryClient.refetchQueries({ queryKey: adminKeys.user(staffId), exact: true })
      return queryClient.getQueryData<AdminUser>(adminKeys.user(staffId))
    },
    [queryClient],
  )
}

/** Re-reads one person as soon as the caller mounts; `true` while in flight. */
export function useRecheckAdminUser(staffId: string): boolean {
  const readNow = useReadAdminUserNow()
  const [checking, setChecking] = useState(true)
  useEffect(() => {
    let mounted = true
    void readNow(staffId).finally(() => {
      if (mounted) setChecking(false)
    })
    return () => {
      mounted = false
    }
  }, [readNow, staffId])
  return checking
}

/** GET /admin/teams for a status (the user filters ask for `all`). */
export function useAdminTeams(
  status: TeamStatusFilter,
  { enabled = true }: { enabled?: boolean } = {},
): UseQueryResult<AdminTeamList, ApiProblem> {
  return useQuery<AdminTeamList, ApiProblem>({
    queryKey: adminKeys.teamList(status),
    queryFn: ({ signal }) => fetchAdminTeams(status, signal),
    enabled,
  })
}

/** GET /admin/teams/{id}: the team and its members. */
export function useAdminTeam(teamId: string | null): UseQueryResult<AdminTeamDetail, ApiProblem> {
  return useQuery<AdminTeamDetail, ApiProblem>({
    queryKey: adminKeys.team(teamId ?? ''),
    queryFn: ({ signal }) => fetchAdminTeam(teamId ?? '', signal),
    enabled: teamId !== null,
  })
}

/**
 * Live wiring of both admin screens: `admin:directory` while mounted, and a
 * refetch of every admin cache after a reconnect (envelopes may have been missed).
 */
export function useAdminLive(enabled = true): void {
  const queryClient = useQueryClient()
  useRealtimeSubscription(enabled ? topics.adminDirectory() : null)
  useOnReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.all })
  }, enabled)
}

/**
 * The rail badge of "Usuarios y roles" (contract §10.1, §10.9): how many
 * accounts are locked now. Fetches (the default list, shared with the screen)
 * and subscribes to `admin:directory` only while `enabled` (the Administración
 * role is the visible one); otherwise `undefined` and no request.
 */
export function useLockedAccountsCount({ enabled }: { enabled: boolean }): number | undefined {
  useAdminLive(enabled)
  const query = useQuery<AdminUserList, ApiProblem, number>({
    queryKey: adminKeys.userList({}),
    queryFn: ({ signal }) => fetchAdminUsers({}, signal),
    refetchInterval: DIRECTORY_REFETCH_MS,
    select: (list) => list.statusCounts.locked,
    enabled,
  })
  return enabled ? query.data : undefined
}
