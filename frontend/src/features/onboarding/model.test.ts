import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import {
  COMMON_PASSWORDS,
  devEmailKindLabel,
  invalidLinkCopy,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  activationSteps,
  confirmationError,
  describeOnboardingFailure,
  firstName,
  firstPasswordField,
  fold,
  groupKey,
  passwordChecks,
  passwordReady,
  personalPieces,
  roleLabels,
} from './model'

const bruna = { email: 'bruna.esteves@latambank.example', name: 'Bruna Esteves' }
const states = (password: string, confirmation = '') =>
  Object.fromEntries(passwordChecks(password, confirmation, bruna).map((c) => [c.key, c.state]))

const problem = (code: string, extensions: Record<string, unknown> = {}, status = 422) =>
  new ApiProblem({ status, code, extensions })

describe('password policy (mirror of backend password_policy.py)', () => {
  it('pins the thresholds and the block list to the backend values', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12)
    expect(PASSWORD_MAX_LENGTH).toBe(128)
    expect([...COMMON_PASSWORDS].sort()).toEqual(
      [
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
      ].sort(),
    )
  })

  it('folds like the backend: accents, case and spaces', () => {
    expect(fold('  Contraseña   ÁRBOL ')).toBe('contrasena arbol')
  })

  it('collects the email name, its pieces and the name words of 3+ letters', () => {
    expect(personalPieces('bruna.esteves@latambank.example', 'Bruna Esteves')).toEqual([
      'bruna',
      'bruna.esteves',
      'esteves',
    ])
    expect(personalPieces('a.de-la.rua@x.example', 'Ana de la Rúa')).toEqual([
      'a.de-la.rua',
      'ana',
      'rua',
    ])
  })

  it('shows every rule pending until something is typed', () => {
    expect(states('')).toEqual({
      length: 'pending',
      personal: 'pending',
      common: 'pending',
      match: 'pending',
    })
    expect(passwordChecks('', '', bruna).map((c) => [c.label, c.srState])).toEqual([
      ['Al menos 12 caracteres', ': pendiente'],
      ['No incluye tu nombre ni tu correo', ': pendiente'],
      ['No es una contraseña común', ': pendiente'],
      ['Las dos contraseñas coinciden', ': pendiente'],
    ])
  })

  it('checks length, personal info (accent-insensitive), the block list and the match', () => {
    expect(states('corta')).toMatchObject({ length: 'bad', personal: 'ok', common: 'ok' })
    expect(states('Verde-Bruna-2027')).toMatchObject({ length: 'ok', personal: 'bad' })
    expect(states('Verde-ESTÉVES-27')).toMatchObject({ personal: 'bad' })
    expect(states('LatamBank2026')).toMatchObject({ length: 'ok', common: 'bad' })
    expect(states('Verde-Andes-27', 'Verde-Andes-2')).toMatchObject({ match: 'bad' })
    const good = passwordChecks('Verde-Andes-27', 'Verde-Andes-27', bruna)
    expect(good.every((c) => c.state === 'ok' && c.srState === ': cumple')).toBe(true)
    expect(passwordReady(good)).toBe(true)
    expect(passwordChecks('x'.repeat(129), 'x'.repeat(129), bruna)[0]?.state).toBe('bad')
  })

  it('focuses the password while one of its rules fails, else the confirmation', () => {
    expect(firstPasswordField(passwordChecks('corta', 'corta', bruna))).toBe('password')
    expect(firstPasswordField(passwordChecks('Verde-Andes-27', '', bruna))).toBe('confirm')
    expect(confirmationError('a', '')).toBeNull()
    expect(confirmationError('a', 'b')).toBe('Las dos contraseñas no coinciden.')
    expect(confirmationError('a', 'a')).toBeNull()
  })
})

describe('activation', () => {
  it('marks the current step and the done ones', () => {
    expect(activationSteps('password').map((s) => [s.label, s.status, s.srState])).toEqual([
      ['Contraseña', 'current', ', paso actual'],
      ['Verificación en dos pasos', 'pending', ', pendiente'],
    ])
    expect(activationSteps('verification').map((s) => s.status)).toEqual(['done', 'current'])
  })

  it('words the welcome line and groups the manual key', () => {
    expect(firstName('Bruna Esteves')).toBe('Bruna')
    expect(roleLabels(['supervisor', 'analyst'])).toEqual(['Analista', 'Supervisión'])
    expect(groupKey('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP')
    expect(groupKey('RITXTQQQH5433LHJAHU3GVWNMQXDG2W7')).toBe(
      'RITX TQQQ H543 3LHJ AHU3 GVWN MQXD G2W7',
    )
  })
})

describe('describeOnboardingFailure', () => {
  it('turns an unusable link into the invalid screen', () => {
    expect(describeOnboardingFailure(problem('link_invalid', {}, 410))).toEqual({
      kind: 'invalid',
    })
  })

  it('says until when after too many attempts', () => {
    expect(
      describeOnboardingFailure(problem('rate_limited', { unlockAt: '2026-10-03T16:30:00Z' }, 429)),
    ).toEqual({
      kind: 'message',
      message: 'Demasiados intentos. Vuelve a intentarlo a las 11:30.',
    })
    expect(describeOnboardingFailure(problem('rate_limited', {}, 429))).toMatchObject({
      message: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
    })
  })

  it('explains a rejected password on the password field', () => {
    expect(
      describeOnboardingFailure(problem('password_rejected', { reasons: ['personal_info'] })),
    ).toEqual({
      kind: 'message',
      field: 'password',
      message: 'La contraseña incluye tu nombre o tu correo. Elige otra.',
    })
    expect(
      describeOnboardingFailure(problem('password_rejected', { reasons: ['min_length', 'common'] }))
        .kind === 'message',
    ).toBe(true)
    expect(describeOnboardingFailure(problem('password_rejected'))).toMatchObject({
      message: 'La contraseña no cumple los requisitos. Elige otra.',
    })
  })

  it('handles wrong codes, the code lock and a missing step 1', () => {
    expect(describeOnboardingFailure(problem('totp_invalid', { remainingAttempts: 4 }))).toEqual({
      kind: 'message',
      field: 'code',
      message:
        'El código no coincide. Escribe el código que muestra ahora tu app. Te quedan 4 intentos.',
    })
    expect(
      describeOnboardingFailure(problem('totp_invalid', { remainingAttempts: 1 })),
    ).toMatchObject({ message: expect.stringContaining('Te queda 1 intento.') })
    expect(
      describeOnboardingFailure(
        problem('account_locked', { unlockAt: '2026-10-03T16:30:00Z' }, 423),
      ),
    ).toEqual({
      kind: 'message',
      field: 'code',
      message: 'Escribiste un código equivocado demasiadas veces. Vuelve a intentarlo a las 11:30.',
    })
    expect(describeOnboardingFailure(problem('invalid_transition', {}, 409))).toEqual({
      kind: 'restart',
      message: 'Vuelve a crear tu contraseña para continuar.',
    })
    expect(describeOnboardingFailure(new Error('boom'))).toEqual({
      kind: 'message',
      message: 'No pudimos completar este paso. Inténtalo de nuevo.',
    })
    expect(describeOnboardingFailure(ApiProblem.network())).toMatchObject({ kind: 'message' })
  })

  it('words the invalid link per kind', () => {
    expect(invalidLinkCopy('invitation').text).toBe(
      'Los enlaces de invitación duran 48 horas y sirven una sola vez.',
    )
    expect(invalidLinkCopy('reset').askTitle).toBe('Pide un enlace nuevo a administración')
  })
})

describe('dev mailbox', () => {
  it('labels the kinds', () => {
    expect(devEmailKindLabel('invitation')).toBe('Invitación')
    expect(devEmailKindLabel('password_reset')).toBe('Restablecer contraseña')
  })
})
