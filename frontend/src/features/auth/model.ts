/**
 * Pure auth rules and copy: form validation, problem → message mapping,
 * lockout countdown and the router state passed between the login steps.
 * No React, no I/O: unit-tested in model.test.ts. Copy comes from the `auth` catalog,
 * read when a function runs (so it is in the UI language of that moment).
 */
import { ApiProblem, type Schemas } from '@/lib/api'
import { formatTime, formatTimer } from '@/lib/format'
import { i18n } from '@/lib/i18n'

const t = i18n.getFixedT(null, 'auth')

export const MFA_CODE_LENGTH = 6
/** Lockout policy shown in the copy (brief §4.5, canvas BoLocked). */
export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 15

// ── Router state between /login, /login/verify and /login/locked ──

export type MfaMethodId = Schemas['MfaMethod']

export interface MfaRouteState {
  challengeId: string
  email: string
  /** Page the user originally asked for (kept for the post-login redirect). */
  from?: string
}

export interface LockedRouteState {
  email?: string
  /** ISO-8601 UTC. */
  unlockAt?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function readMfaState(state: unknown): MfaRouteState | null {
  if (!isRecord(state)) return null
  const { challengeId, email, from } = state
  if (typeof challengeId !== 'string' || !challengeId || typeof email !== 'string') return null
  return { challengeId, email, ...(typeof from === 'string' ? { from } : {}) }
}

export function readLockedState(state: unknown): LockedRouteState {
  if (!isRecord(state)) return {}
  const { email, unlockAt } = state
  return {
    ...(typeof email === 'string' ? { email } : {}),
    ...(typeof unlockAt === 'string' && !Number.isNaN(Date.parse(unlockAt)) ? { unlockAt } : {}),
  }
}

// ── Login form ──

export interface LoginValues {
  email: string
  password: string
}

export type LoginErrors = Partial<Record<keyof LoginValues, string>>

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateLogin({ email, password }: LoginValues): LoginErrors {
  const errors: LoginErrors = {}
  const trimmed = email.trim()
  if (!trimmed) errors.email = t('validation.emailRequired')
  else if (!EMAIL_PATTERN.test(trimmed)) errors.email = t('validation.emailInvalid')
  if (!password) errors.password = t('validation.passwordRequired')
  return errors
}

// ── Problem → what the screen does ──

export type AuthFailure =
  | { kind: 'message'; message: string }
  | { kind: 'locked'; unlockAt: string | null }
  /** The MFA challenge is gone: start again from the password step. */
  | { kind: 'restart'; message: string }

function genericFailure(): AuthFailure {
  return { kind: 'message', message: t('failure.generic') }
}

function asProblem(error: unknown): ApiProblem | null {
  return error instanceof ApiProblem ? error : null
}

export function describeLoginFailure(error: unknown): AuthFailure {
  const problem = asProblem(error)
  if (!problem) return genericFailure()
  switch (problem.code) {
    case 'account_locked':
      return { kind: 'locked', unlockAt: problem.stringExtension('unlockAt') }
    case 'invalid_credentials': {
      const remaining = problem.numberExtension('remainingAttempts')
      const message =
        remaining !== null && remaining > 0
          ? t('failure.credentialsAttempts', { count: remaining, minutes: LOCKOUT_MINUTES })
          : t('failure.credentials')
      return { kind: 'message', message }
    }
    case 'validation_error':
      return { kind: 'message', message: t('failure.validation') }
    case 'network_error':
      return { kind: 'message', message: problem.title }
    default:
      return genericFailure()
  }
}

export function describeMfaFailure(error: unknown): AuthFailure {
  const problem = asProblem(error)
  if (!problem) return genericFailure()
  switch (problem.code) {
    case 'account_locked':
      return { kind: 'locked', unlockAt: problem.stringExtension('unlockAt') }
    case 'mfa_invalid': {
      const remaining = problem.numberExtension('remainingAttempts')
      const message =
        remaining !== null && remaining > 0
          ? t('failure.mfaInvalidAttempts', { count: remaining })
          : t('failure.mfaInvalid')
      return { kind: 'message', message }
    }
    case 'mfa_challenge_invalid':
      return { kind: 'restart', message: t('failure.mfaExpired') }
    case 'network_error':
      return { kind: 'message', message: problem.title }
    default:
      return genericFailure()
  }
}

// ── MFA code ──

export function isCompleteCode(code: string): boolean {
  return new RegExp(`^\\d{${MFA_CODE_LENGTH}}$`).test(code)
}

/**
 * The one second factor the product offers: the authenticator app. The API also
 * names `sms` and `backup_code`, but nothing sends an SMS or issues backup codes,
 * so the screen never offers them (no false "we sent you a code").
 */
export const MFA_METHOD: MfaMethodId = 'totp'

// Who helps (`auth:help`, `auth:login.forgotHelp`, `auth:locked.help`): Administración unlocks
// and sends reset links in "Usuarios y roles" (slice 4, part 4). Nobody hands out a password.

// ── Lockout countdown ──

/** Whole seconds until `unlockAt` (never negative). */
export function secondsUntil(unlockAt: string | Date, now: Date | number = Date.now()): number {
  const target = unlockAt instanceof Date ? unlockAt.getTime() : Date.parse(unlockAt)
  const current = now instanceof Date ? now.getTime() : now
  if (Number.isNaN(target)) return 0
  return Math.max(0, Math.ceil((target - current) / 1000))
}

/** "14:32" (mm:ss) for the lockout tile. */
export function formatCountdown(seconds: number): string {
  return formatTimer(seconds)
}

/** "Hubo 5 intentos fallidos para x. Podrás volver a intentar a las 10:47." */
export function lockedDescription({ email, unlockAt }: LockedRouteState): string {
  const attempts = MAX_FAILED_ATTEMPTS
  const what = email
    ? t('locked.descriptionFor', { attempts, email })
    : t('locked.description', { attempts })
  return unlockAt ? `${what} ${t('locked.retryAt', { time: formatTime(unlockAt) })}` : what
}
