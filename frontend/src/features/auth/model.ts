/**
 * Pure auth rules and copy: form validation, problem → message mapping,
 * lockout countdown and the router state passed between the login steps.
 * No React, no I/O: unit-tested in model.test.ts.
 */
import { ApiProblem, type Schemas } from '@/lib/api'
import { formatTime, formatTimer } from '@/lib/format'

export const MFA_CODE_LENGTH = 6
/** Lockout policy shown in the copy (brief §4.5, canvas BoLocked). */
export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 15

// ── Router state between /login, /login/verificacion and /login/bloqueada ──

export type MfaMethodId = Schemas['MfaMethod']

export interface MfaRouteState {
  challengeId: string
  email: string
  /** Methods the account can use (from POST /auth/login). */
  methods?: MfaMethodId[]
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

const MFA_METHOD_IDS: readonly MfaMethodId[] = ['totp', 'sms', 'backup_code']

function isMfaMethod(value: unknown): value is MfaMethodId {
  return typeof value === 'string' && (MFA_METHOD_IDS as readonly string[]).includes(value)
}

export function readMfaState(state: unknown): MfaRouteState | null {
  if (!isRecord(state)) return null
  const { challengeId, email, methods, from } = state
  if (typeof challengeId !== 'string' || !challengeId || typeof email !== 'string') return null
  const validMethods = Array.isArray(methods) ? methods.filter(isMfaMethod) : []
  return {
    challengeId,
    email,
    ...(validMethods.length > 0 ? { methods: validMethods } : {}),
    ...(typeof from === 'string' ? { from } : {}),
  }
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
  if (!trimmed) errors.email = 'Escribe tu correo.'
  else if (!EMAIL_PATTERN.test(trimmed))
    errors.email = 'Revisa el correo: debe tener la forma nombre@dominio.'
  if (!password) errors.password = 'Escribe tu contraseña.'
  return errors
}

// ── Problem → what the screen does ──

export type AuthFailure =
  | { kind: 'message'; message: string }
  | { kind: 'locked'; unlockAt: string | null }
  /** The MFA challenge is gone: start again from the password step. */
  | { kind: 'restart'; message: string }

const GENERIC_FAILURE = 'No pudimos completar el ingreso. Intenta de nuevo en unos segundos.'

function attemptsSentence(remaining: number | null): string {
  if (remaining === null) return ''
  if (remaining <= 0) return ''
  return remaining === 1 ? ' Te queda 1 intento.' : ` Te quedan ${remaining} intentos.`
}

function asProblem(error: unknown): ApiProblem | null {
  return error instanceof ApiProblem ? error : null
}

export function describeLoginFailure(error: unknown): AuthFailure {
  const problem = asProblem(error)
  if (!problem) return { kind: 'message', message: GENERIC_FAILURE }
  switch (problem.code) {
    case 'account_locked':
      return { kind: 'locked', unlockAt: problem.stringExtension('unlockAt') }
    case 'invalid_credentials': {
      const remaining = problem.numberExtension('remainingAttempts')
      const tail =
        remaining !== null && remaining > 0
          ? ` Te ${remaining === 1 ? 'queda 1 intento' : `quedan ${remaining} intentos`} antes de que la cuenta se bloquee por ${LOCKOUT_MINUTES} minutos.`
          : ''
      return { kind: 'message', message: `El correo o la contraseña no coinciden.${tail}` }
    }
    case 'validation_error':
      return { kind: 'message', message: 'Revisa el correo y la contraseña e intenta de nuevo.' }
    case 'network_error':
      return { kind: 'message', message: problem.title }
    default:
      return { kind: 'message', message: GENERIC_FAILURE }
  }
}

export function describeMfaFailure(error: unknown): AuthFailure {
  const problem = asProblem(error)
  if (!problem) return { kind: 'message', message: GENERIC_FAILURE }
  switch (problem.code) {
    case 'account_locked':
      return { kind: 'locked', unlockAt: problem.stringExtension('unlockAt') }
    case 'mfa_invalid':
      return {
        kind: 'message',
        message: `El código no es válido o ya venció. Escribe el código que muestra ahora tu app, o elige otro método abajo.${attemptsSentence(problem.numberExtension('remainingAttempts'))}`,
      }
    case 'mfa_challenge_invalid':
      return {
        kind: 'restart',
        message: 'Tu ingreso venció. Escribe otra vez tu correo y contraseña.',
      }
    case 'network_error':
      return { kind: 'message', message: problem.title }
    default:
      return { kind: 'message', message: GENERIC_FAILURE }
  }
}

// ── MFA code ──

export function isCompleteCode(code: string): boolean {
  return new RegExp(`^\\d{${MFA_CODE_LENGTH}}$`).test(code)
}

export interface MfaMethod {
  id: MfaMethodId
  label: string
  instructions: string
  hint: string
}

/** Copy from the canvas (BoMfa); `id` is the API `MfaMethod` sent with the code. */
export const MFA_METHODS: readonly MfaMethod[] = [
  {
    id: 'totp',
    label: 'App de autenticación',
    instructions: 'Escribe el código de 6 dígitos de tu aplicación de autenticación.',
    hint: 'El código cambia cada 30 segundos.',
  },
  {
    id: 'sms',
    label: 'SMS',
    instructions: 'Te enviamos un código por SMS a tu celular registrado.',
    hint: 'Si no llega en un minuto, elige otro método.',
  },
  {
    id: 'backup_code',
    label: 'Código de respaldo',
    instructions:
      'Escribe uno de los códigos de respaldo que guardaste al activar el segundo factor.',
    hint: 'Cada código de respaldo sirve una sola vez.',
  },
]

/** The methods to offer: the ones the API allows for this challenge, in canvas order. */
export function availableMfaMethods(
  allowed: readonly MfaMethodId[] | undefined,
): readonly MfaMethod[] {
  if (!allowed || allowed.length === 0) return MFA_METHODS
  const filtered = MFA_METHODS.filter((method) => allowed.includes(method.id))
  return filtered.length > 0 ? filtered : MFA_METHODS
}

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
  const who = email ? ` para ${email}` : ''
  const when = unlockAt ? ` Podrás volver a intentar a las ${formatTime(unlockAt)}.` : ''
  return `Hubo ${MAX_FAILED_ATTEMPTS} intentos fallidos${who}.${when}`
}
