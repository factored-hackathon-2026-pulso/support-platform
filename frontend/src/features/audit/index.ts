/**
 * Public API of the audit feature: the Auditoría screen, its URL state and
 * query keys (docs/platform/api/slice-3-supervision.md §8.8–§8.10). Imports
 * only `@/features/conversation` (short case ids) and `@/app/roles`.
 */
export { AuditScreen } from './components/AuditScreen'
export type { AuditScreenProps } from './components/AuditScreen'
export { auditKeys } from './api'
export { parseAuditSearch, toAuditSearch } from './url'
export type { AuditStateChangeOptions, AuditUrlState } from './url'
export type { AuditActorKind, AuditEvent, AuditEventPage, AuditFamily, AuditQuery } from './types'
