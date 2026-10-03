/**
 * API types of the supervision feature (docs/platform/api/slice-3-supervision.md
 * §4.2): aliases of the schemas generated from `backend/openapi.json` (`pnpm gen:api`).
 */
import type { CaseSummary } from '@/features/cases/core'
import type { AssignmentOut, Language } from '@/features/conversation/core'
import type { Schemas } from '@/lib/api'

export type { AssignmentOut, CaseSummary, Language }

export type StaffRole = Schemas['StaffRole']
export type AvailabilityStatus = Schemas['AvailabilityStatus']

/** "Ahora": derived by the server, never stored (§2.2). */
export type AnalystActivity = Schemas['AnalystActivity']
export type ActivityCounts = Schemas['ActivityCounts']
export type TeamRef = Schemas['TeamRef']
export type TeamSummary = Schemas['TeamSummary']
export type AnalystCaseCounts = Schemas['AnalystCaseCounts']
export type TeamAnalyst = Schemas['TeamAnalyst']
export type TeamOverview = Schemas['TeamOverview']

export type LanguageQueue = Schemas['LanguageQueue']
export type QueueCount = Schemas['QueueCount']
export type QueueCounts = Schemas['QueueCounts']
export type QueueOverview = Schemas['QueueOverview']

export type SetAssigneeRequest = Schemas['SetAssigneeRequest']
export type AssignmentResult = Schemas['AssignmentResult']
