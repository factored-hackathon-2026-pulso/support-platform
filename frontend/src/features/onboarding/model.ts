/**
 * Pure rules and copy of the onboarding links (part 4, BoActivar.dc.html): the
 * password policy shown live (a mirror of the backend's
 * `domain/people/password_policy.py`, pinned by model.test.ts), the steps of the
 * activation, the manual key grouping, the problem → copy mapping and the dev
 * mailbox labels. No React, no I/O: unit-tested in model.test.ts.
 */
import { ROLE_LABEL, sortRoles } from '@/app/roles'
import { isApiProblem } from '@/lib/api'
import { formatTime } from '@/lib/format'
import type { DevEmail, StaffRole } from './types'

// ── Password policy (mirror of the backend; the server checks it again) ──────

/** Team-generated thresholds, as `password_policy.py` defines them. */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128
/** Pieces of the email name or of her name shorter than this are not checked. */
export const MIN_PERSONAL_PIECE = 3

/** The block list of the backend (folded: lower case, accents removed). */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456789012',
  '1234567890123',
  'contrasena123',
  'contrasena1234',
  'password1234',
  'password12345',
  'qwertyuiop12',
  'qwertyuiop123',
  'latambank2026',
  'latambank123',
  'bienvenido123',
  'bienvenido2026',
  'abcdefghijkl',
  '000000000000',
  '111111111111',
])

/** The backend's `fold`: NFKD, accents stripped, spaces collapsed, case-folded. */
export function fold(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

/** The words a password must not contain: her email name, its pieces, her name's words. */
export function personalPieces(email: string, name: string): string[] {
  const local = fold(email.split('@')[0] ?? '')
  const pieces = new Set<string>([local, ...local.split(/[^0-9a-z]+/), ...fold(name).split(/\s+/)])
  return [...pieces].filter((piece) => piece.length >= MIN_PERSONAL_PIECE).sort()
}

export type RuleState = 'ok' | 'bad' | 'pending'

export type PasswordCheckKey = 'length' | 'personal' | 'common' | 'match'

export interface PasswordCheck {
  key: PasswordCheckKey
  label: string
  state: RuleState
  /** Read after the label by screen readers (": cumple"). */
  srState: string
}

export const PASSWORD_CHECK_LABEL: Record<PasswordCheckKey, string> = {
  length: `Al menos ${PASSWORD_MIN_LENGTH} caracteres`,
  personal: 'No incluye tu nombre ni tu correo',
  common: 'No es una contraseña común',
  match: 'Las dos contraseñas coinciden',
}

const SR_STATE: Record<RuleState, string> = {
  ok: ': cumple',
  bad: ': no cumple',
  pending: ': pendiente',
}

export interface PasswordOwner {
  email: string
  name: string
}

/**
 * The four live checks (BoActivar `rules`): pending while nothing is typed, then ok
 * or bad. Length and personal info as the server checks them; "coinciden" compares
 * the confirmation.
 */
export function passwordChecks(
  password: string,
  confirmation: string,
  owner: PasswordOwner,
): PasswordCheck[] {
  const folded = fold(password)
  const typed = password.length > 0
  const ok = {
    length: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    personal: typed && !personalPieces(owner.email, owner.name).some((p) => folded.includes(p)),
    common: typed && !COMMON_PASSWORDS.has(folded),
    match: confirmation.length > 0 && confirmation === password,
  }
  const touched = { length: typed, personal: typed, common: typed, match: confirmation.length > 0 }
  return (Object.keys(PASSWORD_CHECK_LABEL) as PasswordCheckKey[]).map((key) => {
    const state: RuleState = ok[key] ? 'ok' : touched[key] ? 'bad' : 'pending'
    return { key, label: PASSWORD_CHECK_LABEL[key], state, srState: SR_STATE[state] }
  })
}

export function passwordReady(checks: readonly PasswordCheck[]): boolean {
  return checks.every((check) => check.state === 'ok')
}

/** Which field to focus when "Continuar" is pressed too early (the first broken one). */
export function firstPasswordField(checks: readonly PasswordCheck[]): 'password' | 'confirm' {
  return checks.some((check) => check.key !== 'match' && check.state !== 'ok')
    ? 'password'
    : 'confirm'
}

export const MISMATCH_ERROR = 'Las dos contraseñas no coinciden.'

/** "Las dos contraseñas no coinciden." while the confirmation differs (never while empty). */
export function confirmationError(password: string, confirmation: string): string | null {
  return confirmation.length > 0 && confirmation !== password ? MISMATCH_ERROR : null
}

const RULE_COPY: Record<string, string> = {
  min_length: `tiene menos de ${PASSWORD_MIN_LENGTH} caracteres`,
  max_length: `tiene más de ${PASSWORD_MAX_LENGTH} caracteres`,
  personal_info: 'incluye tu nombre o tu correo',
  common: 'es una contraseña común',
}

// ── Activation steps (BoActivar `steps`) ─────────────────────────────────────

export type ActivationStep = 'password' | 'verification' | 'done'

export interface StepItem {
  key: 'password' | 'verification'
  number: number
  label: string
  status: 'done' | 'current' | 'pending'
  /** Read after the label (", paso actual"). */
  srState: string
}

export function activationSteps(step: ActivationStep): StepItem[] {
  const current = step === 'password' ? 0 : 1
  return (
    [
      ['password', 'Contraseña'],
      ['verification', 'Verificación en dos pasos'],
    ] as const
  ).map(([key, label], index) => {
    const status = index < current ? 'done' : index === current ? 'current' : 'pending'
    return {
      key,
      number: index + 1,
      label,
      status,
      srState:
        status === 'done' ? ', listo' : status === 'current' ? ', paso actual' : ', pendiente',
    }
  })
}

/** "Daniela" from "Daniela Ríos". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** "Analista", "Analista y Supervisión" (the role pills of the welcome line). */
export function roleLabels(roles: readonly StaffRole[]): string[] {
  return sortRoles(roles).map((role) => ROLE_LABEL[role])
}

/** The manual key in blocks of 4 ("JBSW Y3DP EHPK 3PXP") for reading and typing. */
export function groupKey(secret: string): string {
  return (secret.replace(/\s+/g, '').match(/.{1,4}/g) ?? []).join(' ')
}

export const CODE_LENGTH = 6
export const CODE_REQUIRED_ERROR = 'Escribe los 6 dígitos que muestra tu app.'

// ── Problems → what the screen does ──────────────────────────────────────────

export type OnboardingFailure =
  /** The link is unknown, expired, used or cancelled: the "venció o ya se usó" screen. */
  | { kind: 'invalid' }
  /** Step 2 without step 1 (the enrollment was reset): back to the password. */
  | { kind: 'restart'; message: string }
  /** A message for a field (`password`, `code`) or the form. */
  | { kind: 'message'; message: string; field?: 'password' | 'code' }

export const GENERIC_ONBOARDING_ERROR = 'No pudimos completar este paso. Inténtalo de nuevo.'

function attempts(remaining: number | null): string {
  if (remaining === null || remaining <= 0) return ''
  return remaining === 1 ? ' Te queda 1 intento.' : ` Te quedan ${remaining} intentos.`
}

export function describeOnboardingFailure(error: unknown): OnboardingFailure {
  if (!isApiProblem(error)) return { kind: 'message', message: GENERIC_ONBOARDING_ERROR }
  switch (error.code) {
    case 'link_invalid':
      return { kind: 'invalid' }
    case 'rate_limited': {
      const unlockAt = error.stringExtension('unlockAt')
      return {
        kind: 'message',
        message: unlockAt
          ? `Demasiados intentos. Vuelve a intentarlo a las ${formatTime(unlockAt)}.`
          : 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
      }
    }
    case 'password_rejected': {
      const reasons = Array.isArray(error.extensions.reasons)
        ? error.extensions.reasons.filter((r): r is string => typeof r === 'string')
        : []
      const parts = reasons.map((reason) => RULE_COPY[reason]).filter(Boolean)
      return {
        kind: 'message',
        field: 'password',
        message:
          parts.length > 0
            ? `La contraseña ${parts.join(' y ')}. Elige otra.`
            : 'La contraseña no cumple los requisitos. Elige otra.',
      }
    }
    case 'totp_invalid':
      return {
        kind: 'message',
        field: 'code',
        message: `El código no coincide. Escribe el código que muestra ahora tu app.${attempts(error.numberExtension('remainingAttempts'))}`,
      }
    case 'account_locked': {
      const unlockAt = error.stringExtension('unlockAt')
      return {
        kind: 'message',
        field: 'code',
        message: unlockAt
          ? `Escribiste un código equivocado demasiadas veces. Vuelve a intentarlo a las ${formatTime(unlockAt)}.`
          : 'Escribiste un código equivocado demasiadas veces. Espera 15 minutos.',
      }
    }
    case 'invalid_transition':
      return { kind: 'restart', message: 'Vuelve a crear tu contraseña para continuar.' }
    case 'network_error':
      return { kind: 'message', message: error.title }
    default:
      return { kind: 'message', message: GENERIC_ONBOARDING_ERROR }
  }
}

// ── The link screens' copy ───────────────────────────────────────────────────

export type LinkKind = 'invitation' | 'reset'

export const INVALID_LINK_COPY: Record<
  LinkKind,
  { text: string; askTitle: string; askText: string }
> = {
  invitation: {
    text: 'Los enlaces de invitación duran 48 horas y sirven una sola vez.',
    askTitle: 'Pide una nueva invitación a administración',
    askText: 'Te llega un correo con un enlace nuevo.',
  },
  reset: {
    text: 'Los enlaces para restablecer la contraseña duran 1 hora y sirven una sola vez.',
    askTitle: 'Pide un enlace nuevo a administración',
    askText: 'Te llega un correo con un enlace nuevo.',
  },
}

/** `?token=` of the link (blank = no token: the invalid screen). */
export function readToken(params: URLSearchParams): string | null {
  const token = params.get('token')?.trim()
  return token ? token : null
}

// ── Dev mailbox (development tool) ───────────────────────────────────────────

export const DEV_EMAIL_KIND_LABEL: Record<DevEmail['kind'], string> = {
  invitation: 'Invitación',
  password_reset: 'Restablecer contraseña',
}

/** The link of an email as an in-app path ("/activar?token=…"), or null when foreign. */
export function inAppPath(link: string): string | null {
  try {
    const url = new URL(link)
    if (url.pathname !== '/activar' && url.pathname !== '/restablecer') return null
    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}
