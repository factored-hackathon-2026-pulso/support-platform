/**
 * Pure rules and copy of the onboarding links (part 4, BoActivar.dc.html): the
 * password policy shown live (a mirror of the backend's
 * `domain/people/password_policy.py`, pinned by model.test.ts), the steps of the
 * activation, the manual key grouping, the problem → copy mapping and the dev
 * mailbox labels. No React, no I/O: unit-tested in model.test.ts. Copy comes from the
 * `onboarding` catalog, read when a function runs (the UI language of that moment).
 */
import { ROLE_LABEL, sortRoles } from '@/app/roles'
import { isApiProblem } from '@/lib/api'
import { formatList, formatTime } from '@/lib/format'
import { i18n } from '@/lib/i18n'
import type { DevEmail, StaffRole } from './types'

const t = i18n.getFixedT(null, 'onboarding')

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

const PASSWORD_CHECK_KEYS: readonly PasswordCheckKey[] = ['length', 'personal', 'common', 'match']

/** "Al menos 12 caracteres", "No incluye tu nombre ni tu correo"… */
export function passwordCheckLabel(key: PasswordCheckKey): string {
  return t(`password.rule.${key}`, { min: PASSWORD_MIN_LENGTH })
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
  return PASSWORD_CHECK_KEYS.map((key) => {
    const state: RuleState = ok[key] ? 'ok' : touched[key] ? 'bad' : 'pending'
    return {
      key,
      label: passwordCheckLabel(key),
      state,
      srState: t(`password.ruleState.${state}`),
    }
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

/** "Las dos contraseñas no coinciden." while the confirmation differs (never while empty). */
export function confirmationError(password: string, confirmation: string): string | null {
  return confirmation.length > 0 && confirmation !== password ? t('password.mismatch') : null
}

/** The backend's `password_rejected` reasons. */
const REJECTION_REASONS = ['min_length', 'max_length', 'personal_info', 'common'] as const

type RejectionReason = (typeof REJECTION_REASONS)[number]

function isRejectionReason(value: string): value is RejectionReason {
  return (REJECTION_REASONS as readonly string[]).includes(value)
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
  return (['password', 'verification'] as const).map((key, index) => {
    const status = index < current ? 'done' : index === current ? 'current' : 'pending'
    return {
      key,
      number: index + 1,
      label: t(`steps.${key}`),
      status,
      srState: t(`steps.${status}`),
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

/** "Escribe los 6 dígitos que muestra tu app." */
export function codeRequiredError(): string {
  return t('activation.codeRequired', { length: CODE_LENGTH })
}

// ── Problems → what the screen does ──────────────────────────────────────────

export type OnboardingFailure =
  /** The link is unknown, expired, used or cancelled: the "venció o ya se usó" screen. */
  | { kind: 'invalid' }
  /** Step 2 without step 1 (the enrollment was reset): back to the password. */
  | { kind: 'restart'; message: string }
  /** A message for a field (`password`, `code`) or the form. */
  | { kind: 'message'; message: string; field?: 'password' | 'code' }

function genericFailure(): OnboardingFailure {
  return { kind: 'message', message: t('failure.generic') }
}

export function describeOnboardingFailure(error: unknown): OnboardingFailure {
  if (!isApiProblem(error)) return genericFailure()
  switch (error.code) {
    case 'link_invalid':
      return { kind: 'invalid' }
    case 'rate_limited': {
      const unlockAt = error.stringExtension('unlockAt')
      return {
        kind: 'message',
        message: unlockAt
          ? t('failure.rateLimitedAt', { time: formatTime(unlockAt) })
          : t('failure.rateLimited'),
      }
    }
    case 'password_rejected': {
      const reasons = Array.isArray(error.extensions.reasons)
        ? error.extensions.reasons.filter((r): r is string => typeof r === 'string')
        : []
      const parts = reasons
        .filter(isRejectionReason)
        .map((reason) =>
          t(`password.reason.${reason}`, { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH }),
        )
      return {
        kind: 'message',
        field: 'password',
        message:
          parts.length > 0
            ? t('password.rejected', { reasons: formatList(parts) })
            : t('password.rejectedGeneric'),
      }
    }
    case 'totp_invalid': {
      const remaining = error.numberExtension('remainingAttempts')
      return {
        kind: 'message',
        field: 'code',
        message:
          remaining !== null && remaining > 0
            ? t('failure.totpInvalidAttempts', { count: remaining })
            : t('failure.totpInvalid'),
      }
    }
    case 'account_locked': {
      const unlockAt = error.stringExtension('unlockAt')
      return {
        kind: 'message',
        field: 'code',
        message: unlockAt
          ? t('failure.lockedAt', { time: formatTime(unlockAt) })
          : t('failure.locked'),
      }
    }
    case 'invalid_transition':
      return { kind: 'restart', message: t('failure.restart') }
    case 'network_error':
      return { kind: 'message', message: error.title }
    default:
      return genericFailure()
  }
}

// ── The link screens' copy ───────────────────────────────────────────────────

export type LinkKind = 'invitation' | 'reset'

/** "El enlace venció o ya se usó": what the link was and who sends a new one. */
export function invalidLinkCopy(kind: LinkKind): {
  text: string
  askTitle: string
  askText: string
  done: string
} {
  return {
    text: t(`link.${kind}Text`),
    askTitle: t(`link.${kind}Ask`),
    askText: t('link.askText'),
    done: t(`link.${kind}Done`),
  }
}

// ── Dev mailbox (development tool) ───────────────────────────────────────────

/** "Invitación", "Restablecer contraseña". */
export function devEmailKindLabel(kind: DevEmail['kind']): string {
  return t(`mailbox.kind.${kind}`)
}
