import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import {
  availableMfaMethods,
  describeLoginFailure,
  describeMfaFailure,
  formatCountdown,
  isCompleteCode,
  lockedDescription,
  readLockedState,
  readMfaState,
  secondsUntil,
  validateLogin,
} from './model'

const problem = (status: number, body: Record<string, unknown>) =>
  ApiProblem.fromResponse(status, body)

describe('auth model', () => {
  it('validates the login form', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'Escribe tu correo.',
      password: 'Escribe tu contraseña.',
    })
    expect(validateLogin({ email: 'daniela', password: 'x' }).email).toMatch(/nombre@dominio/)
    expect(validateLogin({ email: ' daniela@example.com ', password: 'x' })).toEqual({})
  })

  it('explains wrong credentials with the attempts left', () => {
    const outcome = describeLoginFailure(
      problem(401, { code: 'invalid_credentials', remainingAttempts: 3 }),
    )
    expect(outcome).toEqual({
      kind: 'message',
      message:
        'El correo o la contraseña no coinciden. Te quedan 3 intentos antes de que la cuenta se bloquee por 15 minutos.',
    })
    expect(
      describeLoginFailure(problem(401, { code: 'invalid_credentials', remainingAttempts: 1 })),
    ).toMatchObject({
      message: expect.stringContaining('Te queda 1 intento'),
    })
    expect(describeLoginFailure(problem(401, { code: 'invalid_credentials' }))).toEqual({
      kind: 'message',
      message: 'El correo o la contraseña no coinciden.',
    })
  })

  it('detects lockouts, expired challenges and unknown failures', () => {
    expect(
      describeLoginFailure(
        problem(423, { code: 'account_locked', unlockAt: '2026-10-02T15:47:00Z' }),
      ),
    ).toEqual({
      kind: 'locked',
      unlockAt: '2026-10-02T15:47:00Z',
    })
    expect(describeMfaFailure(problem(423, { code: 'account_locked' }))).toEqual({
      kind: 'locked',
      unlockAt: null,
    })
    expect(describeMfaFailure(problem(401, { code: 'mfa_challenge_invalid' })).kind).toBe('restart')
    expect(
      describeMfaFailure(problem(401, { code: 'mfa_invalid', remainingAttempts: 2 })),
    ).toMatchObject({
      kind: 'message',
      message: expect.stringContaining('Te quedan 2 intentos.'),
    })
    expect(describeLoginFailure(new Error('boom')).kind).toBe('message')
    expect(describeLoginFailure(ApiProblem.network())).toMatchObject({
      message: expect.stringContaining('conexión'),
    })
  })

  it('offers only the MFA methods the challenge allows', () => {
    expect(availableMfaMethods(['totp']).map((m) => m.id)).toEqual(['totp'])
    expect(availableMfaMethods(undefined).map((m) => m.id)).toEqual(['totp', 'sms', 'backup_code'])
    expect(availableMfaMethods([]).length).toBe(3)
  })

  it('checks the 6-digit code', () => {
    expect(isCompleteCode('000000')).toBe(true)
    expect(isCompleteCode('00000')).toBe(false)
    expect(isCompleteCode('00000a')).toBe(false)
  })

  it('reads router state defensively', () => {
    expect(
      readMfaState({
        challengeId: 'CH-1',
        email: 'a@b.co',
        methods: ['sms', 'fax'],
        from: '/analista',
      }),
    ).toEqual({ challengeId: 'CH-1', email: 'a@b.co', methods: ['sms'], from: '/analista' })
    expect(readMfaState({ email: 'a@b.co' })).toBeNull()
    expect(readMfaState(null)).toBeNull()
    expect(readLockedState({ email: 'a@b.co', unlockAt: 'not a date' })).toEqual({
      email: 'a@b.co',
    })
  })

  it('counts down to the unlock time', () => {
    const now = Date.parse('2026-10-02T15:32:28Z')
    expect(secondsUntil('2026-10-02T15:47:00Z', now)).toBe(872)
    expect(formatCountdown(872)).toBe('14:32')
    expect(secondsUntil('2026-10-02T15:00:00Z', now)).toBe(0)
    expect(lockedDescription({ email: 'a@b.co' })).toBe('Hubo 5 intentos fallidos para a@b.co.')
    // The unlock time is on the viewer's clock (tests pin America/Bogota).
    expect(lockedDescription({ email: 'a@b.co', unlockAt: '2026-10-02T15:47:00Z' })).toBe(
      'Hubo 5 intentos fallidos para a@b.co. Podrás volver a intentar a las 10:47.',
    )
  })
})
