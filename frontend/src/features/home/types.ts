/**
 * API types of the home feature (docs/platform/api/slice-6-analyst-home.md §3):
 * aliases of the schemas generated from `backend/openapi.json` (`pnpm gen:api`).
 */
import type { Schemas } from '@/lib/api'

export type AnalystHome = Schemas['AnalystHome']
export type HomeActivity = Schemas['HomeActivity']
export type HomeActivityItem = Schemas['HomeActivityItem']
export type HomeActivityKind = Schemas['HomeActivityKind']
export type HomeTeam = Schemas['HomeTeam']
export type HomeQueue = Schemas['HomeQueue']
export type SinceSource = Schemas['SinceSource']
export type HomeAssistant = Schemas['HomeAssistant']
