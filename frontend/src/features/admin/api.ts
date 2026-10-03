/**
 * Administration calls (docs/platform/api/slice-4-administration.md §5.1):
 * users, teams and their commands. The only module of the feature that talks
 * to the API client; tests mock it with `vi.mock('@/features/admin/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type {
  AdminTeam,
  AdminTeamChange,
  AdminTeamDetail,
  AdminTeamList,
  AdminUser,
  AdminUserChange,
  AdminUserFilters,
  AdminUserList,
  CreateUserRequest,
  CreatedUser,
  PasswordResetResult,
  TeamStatusFilter,
  UpdateUserRequest,
} from './types'

/** Query keys (frozen by the contract §10.12). */
export const adminKeys = {
  all: ['admin'] as const,
  users: () => ['admin', 'users'] as const,
  userList: (filters: AdminUserFilters) => ['admin', 'users', filters] as const,
  user: (staffId: string) => ['admin', 'user', staffId] as const,
  teams: () => ['admin', 'teams'] as const,
  teamList: (status: TeamStatusFilter) => ['admin', 'teams', status] as const,
  team: (teamId: string) => ['admin', 'team', teamId] as const,
}

export const adminMutationKeys = {
  createUser: ['admin', 'create-user'] as const,
  user: (staffId: string, action: 'update' | 'deactivate' | 'reactivate' | 'unlock' | 'reset') =>
    ['admin', 'user', staffId, action] as const,
  createTeam: ['admin', 'create-team'] as const,
  team: (teamId: string, action: 'rename' | 'deactivate' | 'reactivate') =>
    ['admin', 'team', teamId, action] as const,
}

// ── Users ────────────────────────────────────────────────────────────────────

/** GET /admin/users: the directory (≤ 500 rows) and the pill counts. */
export async function fetchAdminUsers(
  filters: AdminUserFilters,
  signal?: AbortSignal,
): Promise<AdminUserList> {
  return unwrap(api.GET('/api/v1/admin/users', { params: { query: filters }, signal }))
}

/** GET /admin/users/{staffId}: one person (inactive ones too). */
export async function fetchAdminUser(staffId: string, signal?: AbortSignal): Promise<AdminUser> {
  return unwrap(api.GET('/api/v1/admin/users/{staffId}', { params: { path: { staffId } }, signal }))
}

/**
 * POST /admin/users. `idempotencyKey` is one per open dialog: a retry of the
 * same create answers 200 with the existing person and `temporaryPassword: null`.
 */
export async function createUser(
  body: CreateUserRequest,
  idempotencyKey: string,
): Promise<CreatedUser> {
  return unwrap(
    api.POST('/api/v1/admin/users', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body,
    }),
  )
}

/** PATCH /admin/users/{staffId}: the changed fields + the version the admin saw. */
export async function updateUser(
  staffId: string,
  body: UpdateUserRequest,
): Promise<AdminUserChange> {
  return unwrap(api.PATCH('/api/v1/admin/users/{staffId}', { params: { path: { staffId } }, body }))
}

export async function deactivateUser(
  staffId: string,
  expectedVersion: number,
): Promise<AdminUserChange> {
  return unwrap(
    api.POST('/api/v1/admin/users/{staffId}/deactivate', {
      params: { path: { staffId } },
      body: { expectedVersion },
    }),
  )
}

export async function reactivateUser(
  staffId: string,
  expectedVersion: number,
): Promise<AdminUserChange> {
  return unwrap(
    api.POST('/api/v1/admin/users/{staffId}/reactivate', {
      params: { path: { staffId } },
      body: { expectedVersion },
    }),
  )
}

export async function unlockUser(staffId: string): Promise<AdminUserChange> {
  return unwrap(api.POST('/api/v1/admin/users/{staffId}/unlock', { params: { path: { staffId } } }))
}

/** POST /admin/users/{staffId}/password-reset: a new temporary password (not idempotent). */
export async function resetPassword(staffId: string): Promise<PasswordResetResult> {
  return unwrap(
    api.POST('/api/v1/admin/users/{staffId}/password-reset', { params: { path: { staffId } } }),
  )
}

// ── Teams ────────────────────────────────────────────────────────────────────

export async function fetchAdminTeams(
  status: TeamStatusFilter,
  signal?: AbortSignal,
): Promise<AdminTeamList> {
  return unwrap(api.GET('/api/v1/admin/teams', { params: { query: { status } }, signal }))
}

export async function fetchAdminTeam(
  teamId: string,
  signal?: AbortSignal,
): Promise<AdminTeamDetail> {
  return unwrap(api.GET('/api/v1/admin/teams/{teamId}', { params: { path: { teamId } }, signal }))
}

export async function createTeam(name: string, idempotencyKey: string): Promise<AdminTeam> {
  return unwrap(
    api.POST('/api/v1/admin/teams', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body: { name },
    }),
  )
}

export async function renameTeam(
  teamId: string,
  name: string,
  expectedVersion: number,
): Promise<AdminTeamChange> {
  return unwrap(
    api.PATCH('/api/v1/admin/teams/{teamId}', {
      params: { path: { teamId } },
      body: { name, expectedVersion },
    }),
  )
}

export async function deactivateTeam(
  teamId: string,
  expectedVersion: number,
): Promise<AdminTeamChange> {
  return unwrap(
    api.POST('/api/v1/admin/teams/{teamId}/deactivate', {
      params: { path: { teamId } },
      body: { expectedVersion },
    }),
  )
}

export async function reactivateTeam(
  teamId: string,
  expectedVersion: number,
): Promise<AdminTeamChange> {
  return unwrap(
    api.POST('/api/v1/admin/teams/{teamId}/reactivate', {
      params: { path: { teamId } },
      body: { expectedVersion },
    }),
  )
}
