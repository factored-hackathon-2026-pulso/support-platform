/**
 * API types of the administration feature
 * (docs/platform/api/slice-4-administration.md §5.2): aliases of the schemas
 * generated from `backend/openapi.json` (`pnpm gen:api`).
 */
import type { Schemas } from '@/lib/api'

export type StaffRole = Schemas['StaffRole']
export type Language = Schemas['Language']
export type AvailabilityStatus = Schemas['AvailabilityStatus']

/** Derived by the server at `serverTime`, never stored (§1.1). */
export type AccountStatus = Schemas['AccountStatus']
export type UserStatusFilter = Schemas['UserStatusFilter']
export type TeamStatusFilter = Schemas['TeamStatusFilter']
export type SelfChangeAction = Schemas['SelfChangeAction']
export type OpenCasesBlock = Schemas['OpenCasesBlock']

export type TeamRef = Schemas['TeamRef']
export type OpenCaseCounts = Schemas['OpenCaseCounts']
export type AdminUserGuards = Schemas['AdminUserGuards']
export type AdminUser = Schemas['AdminUser']
export type AdminUserList = Schemas['AdminUserList']
export type RoleCounts = Schemas['RoleCounts']
export type UserStatusCounts = Schemas['UserStatusCounts']
export type CreateUserRequest = Schemas['CreateUserRequest']
export type InvitedUser = Schemas['InvitedUser']
export type AdminInvitation = Schemas['AdminInvitation']
export type InvitationStatus = Schemas['InvitationStatus']
export type UpdateUserRequest = Schemas['UpdateUserRequest']
export type AdminUserChange = Schemas['AdminUserChange']
export type PasswordResetLinkSent = Schemas['PasswordResetLinkSent']

export type AdminTeam = Schemas['AdminTeam']
export type AdminTeamList = Schemas['AdminTeamList']
export type TeamStatusCounts = Schemas['TeamStatusCounts']
export type AdminTeamMember = Schemas['AdminTeamMember']
export type AdminTeamDetail = Schemas['AdminTeamDetail']
export type AdminTeamChange = Schemas['AdminTeamChange']

/**
 * Filters of GET /admin/users (§4.1), as the screen sends them: defaults and
 * empty values left out, so the default list shares its cache with the rail
 * badge (`useLockedAccountsCount` asks for `{}`). Also part of the query key.
 */
export interface AdminUserFilters {
  q?: string
  role?: StaffRole
  status?: UserStatusFilter
  teamId?: string
  language?: Language
}
