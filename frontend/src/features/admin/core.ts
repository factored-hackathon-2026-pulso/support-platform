/**
 * Core public API of the administration feature: what the always-loaded app
 * shell may import without pulling in any screen (ARCHITECTURE.md §3, "Two
 * public files"). The `directory.updated` handlers, the locked-accounts count
 * behind the rail badge, the query keys and the types. No components and
 * nothing that reaches one: src/test/architecture.test.ts checks it. The role
 * vocabulary the shell needs (labels, "Ahora tienes: …") lives in `@/app/roles`.
 */
export { useLockedAccountsCount } from './hooks/use-admin-queries'
export { adminKeys, adminMutationKeys } from './api'
export { registerAdminRealtime } from './realtime'
export type {
  AccountStatus,
  AdminTeam,
  AdminTeamDetail,
  AdminUser,
  TeamStatusFilter,
  UserStatusFilter,
} from './types'
