/**
 * API types of the onboarding feature (part 4, docs/platform/api/slice-11-invitations.md):
 * aliases of the schemas generated from `backend/openapi.json` (`pnpm gen:api`).
 */
import type { Schemas } from '@/lib/api'

export type InvitationCheck = Schemas['InvitationCheck']
export type TotpEnrollment = Schemas['TotpEnrollment']
export type ActivatedAccount = Schemas['ActivatedAccount']
export type PasswordResetCheck = Schemas['PasswordResetCheck']
export type PasswordResetDone = Schemas['PasswordResetDone']
export type PasswordRule = Schemas['PasswordRule']
export type DevEmail = Schemas['DevEmail']
export type DevMailbox = Schemas['DevMailbox']
export type MetaResponse = Schemas['MetaResponse']
export type StaffRole = Schemas['StaffRole']
