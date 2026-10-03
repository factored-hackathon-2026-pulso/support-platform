import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import {
  adminKeys,
  adminMutationKeys,
  createTeam,
  createUser,
  deactivateTeam,
  deactivateUser,
  reactivateTeam,
  reactivateUser,
  renameTeam,
  resetPassword,
  unlockUser,
  updateUser,
} from '../api'
import type {
  AdminTeam,
  AdminTeamChange,
  AdminTeamDetail,
  AdminUser,
  AdminUserChange,
  CreateUserRequest,
  CreatedUser,
  PasswordResetResult,
  UpdateUserRequest,
} from '../types'

/**
 * After any user command: the returned person replaces the cached one, every
 * list refetches (counts, filters) and so do the teams (memberships, counts).
 */
function storeUser(queryClient: QueryClient, user: AdminUser): void {
  queryClient.setQueryData(adminKeys.user(user.id), user)
  void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
  void queryClient.invalidateQueries({ queryKey: adminKeys.teams() })
  void queryClient.invalidateQueries({ queryKey: ['admin', 'team'] })
}

/** After any team command: the detail gets the new team, the lists refetch. */
function storeTeam(queryClient: QueryClient, team: AdminTeam): void {
  queryClient.setQueryData<AdminTeamDetail>(adminKeys.team(team.id), (detail) =>
    detail ? { ...detail, team } : detail,
  )
  void queryClient.invalidateQueries({ queryKey: adminKeys.teams() })
  void queryClient.invalidateQueries({ queryKey: adminKeys.team(team.id), exact: true })
  // The user rows name the team.
  void queryClient.invalidateQueries({ queryKey: adminKeys.users() })
}

export interface CreateUserVariables {
  body: CreateUserRequest
  /** One per open dialog (contract §10.3). */
  idempotencyKey: string
}

export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation<CreatedUser, ApiProblem, CreateUserVariables>({
    mutationKey: adminMutationKeys.createUser,
    mutationFn: ({ body, idempotencyKey }) => createUser(body, idempotencyKey),
    onSuccess: (result) => storeUser(queryClient, result.user),
  })
}

export function useUpdateUser(staffId: string) {
  const queryClient = useQueryClient()
  return useMutation<AdminUserChange, ApiProblem, UpdateUserRequest>({
    mutationKey: adminMutationKeys.user(staffId, 'update'),
    mutationFn: (body) => updateUser(staffId, body),
    onSuccess: (result) => storeUser(queryClient, result.user),
  })
}

export function useDeactivateUser(staffId: string) {
  const queryClient = useQueryClient()
  return useMutation<AdminUserChange, ApiProblem, number>({
    mutationKey: adminMutationKeys.user(staffId, 'deactivate'),
    mutationFn: (expectedVersion) => deactivateUser(staffId, expectedVersion),
    onSuccess: (result) => storeUser(queryClient, result.user),
  })
}

export function useReactivateUser(staffId: string) {
  const queryClient = useQueryClient()
  return useMutation<AdminUserChange, ApiProblem, number>({
    mutationKey: adminMutationKeys.user(staffId, 'reactivate'),
    mutationFn: (expectedVersion) => reactivateUser(staffId, expectedVersion),
    onSuccess: (result) => storeUser(queryClient, result.user),
  })
}

export function useUnlockUser(staffId: string) {
  const queryClient = useQueryClient()
  return useMutation<AdminUserChange, ApiProblem, void>({
    mutationKey: adminMutationKeys.user(staffId, 'unlock'),
    mutationFn: () => unlockUser(staffId),
    onSuccess: (result) => storeUser(queryClient, result.user),
  })
}

/** The temporary password stays in the mutation result only (never in the query cache). */
export function useResetPassword(staffId: string) {
  const queryClient = useQueryClient()
  return useMutation<PasswordResetResult, ApiProblem, void>({
    mutationKey: adminMutationKeys.user(staffId, 'reset'),
    mutationFn: () => resetPassword(staffId),
    onSuccess: (result) => storeUser(queryClient, result.user),
  })
}

export interface CreateTeamVariables {
  name: string
  idempotencyKey: string
}

export function useCreateTeam() {
  const queryClient = useQueryClient()
  return useMutation<AdminTeam, ApiProblem, CreateTeamVariables>({
    mutationKey: adminMutationKeys.createTeam,
    mutationFn: ({ name, idempotencyKey }) => createTeam(name, idempotencyKey),
    onSuccess: (team) => storeTeam(queryClient, team),
  })
}

export function useRenameTeam(teamId: string) {
  const queryClient = useQueryClient()
  return useMutation<AdminTeamChange, ApiProblem, { name: string; expectedVersion: number }>({
    mutationKey: adminMutationKeys.team(teamId, 'rename'),
    mutationFn: ({ name, expectedVersion }) => renameTeam(teamId, name, expectedVersion),
    onSuccess: (result) => storeTeam(queryClient, result.team),
  })
}

export function useDeactivateTeam(teamId: string) {
  const queryClient = useQueryClient()
  return useMutation<AdminTeamChange, ApiProblem, number>({
    mutationKey: adminMutationKeys.team(teamId, 'deactivate'),
    mutationFn: (expectedVersion) => deactivateTeam(teamId, expectedVersion),
    onSuccess: (result) => storeTeam(queryClient, result.team),
  })
}

export function useReactivateTeam(teamId: string) {
  const queryClient = useQueryClient()
  return useMutation<AdminTeamChange, ApiProblem, number>({
    mutationKey: adminMutationKeys.team(teamId, 'reactivate'),
    mutationFn: (expectedVersion) => reactivateTeam(teamId, expectedVersion),
    onSuccess: (result) => storeTeam(queryClient, result.team),
  })
}

/**
 * "Agregar persona" (contract §3.7, §10.5): membership has one write path, the
 * person's PATCH with `teamId` and the version the admin saw.
 */
export function useMoveToTeam() {
  const queryClient = useQueryClient()
  return useMutation<AdminUserChange, ApiProblem, { user: AdminUser; teamId: string }>({
    mutationFn: ({ user, teamId }) =>
      updateUser(user.id, { expectedVersion: user.version, teamId }),
    onSuccess: (result) => storeUser(queryClient, result.user),
  })
}
