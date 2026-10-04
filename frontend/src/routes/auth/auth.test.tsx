import { act, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login, verifyMfa } from '@/features/auth/api'
import { ApiProblem } from '@/lib/api'
import { sessionToken } from '@/lib/session-token'
import { supervisorStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'

vi.mock('@/features/auth/api', () => ({
  authMutationKeys: { login: ['auth', 'login'], mfa: ['auth', 'mfa'] },
  login: vi.fn<typeof login>(),
  verifyMfa: vi.fn<typeof verifyMfa>(),
}))

const mfaEntry = {
  pathname: '/login/verificacion',
  state: { challengeId: 'CH-1', email: 'laura.mendez@example.com' },
}

beforeEach(() => {
  vi.mocked(login).mockReset()
  vi.mocked(verifyMfa).mockReset()
})

/** Scope queries to the form: the toast region also owns live regions. */
const loginForm = () => screen.getByRole('form', { name: 'Entrar con correo' })

describe('login (BoLogin)', () => {
  it('renders the normal state', async () => {
    renderRoute('/login')
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Correo' })).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password')
    expect(within(loginForm()).queryByRole('alert')).not.toBeInTheDocument()
    // No corporate SSO in this product: only email + password.
    expect(screen.queryByRole('button', { name: /Microsoft/ })).not.toBeInTheDocument()
  })

  it('sends a forgotten password to Administración (a reset link by email)', async () => {
    const { user } = renderRoute('/login')
    await user.click(await screen.findByRole('button', { name: '¿La olvidaste?' }))
    const toasts = screen.getByRole('region', { name: 'Avisos' })
    expect(
      within(toasts).getByText(
        'Pide a Administración un enlace para restablecerla: te llega a tu correo y vence en 1 hora.',
      ),
    ).toBeInTheDocument()
    expect(within(toasts).queryByText(/temporal|mesa de ayuda/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '¿Problemas para entrar?' }))
    expect(
      within(toasts).getByText(
        'Administración desbloquea tu cuenta o te envía por correo un enlace para restablecer la contraseña.',
      ),
    ).toBeInTheDocument()
  })

  it('validates empty fields without calling the API', async () => {
    const { user } = renderRoute('/login')
    await user.click(await screen.findByRole('button', { name: 'Continuar' }))
    expect(screen.getByText('Escribe tu correo.')).toBeInTheDocument()
    expect(screen.getByText('Escribe tu contraseña.')).toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()
    // Focus goes to the first invalid field, which announces its error.
    const email = screen.getByRole('textbox', { name: 'Correo' })
    expect(email).toHaveFocus()
    expect(email).toHaveAccessibleDescription('Escribe tu correo.')
  })

  it('focuses the password when only the password is missing', async () => {
    const { user } = renderRoute('/login')
    await user.type(
      await screen.findByRole('textbox', { name: 'Correo' }),
      'laura.mendez@example.com',
    )
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getByLabelText('Contraseña')).toHaveFocus()
  })

  it('names the browser tab after the step', async () => {
    renderRoute('/login')
    await screen.findByRole('heading', { level: 1, name: 'Entrar' })
    expect(document.title).toBe('Entrar · LATAM Bank Soporte')
  })

  it('shows the error state with the attempts left (BoLoginError)', async () => {
    vi.mocked(login).mockRejectedValue(
      ApiProblem.fromResponse(401, { code: 'invalid_credentials', remainingAttempts: 3 }),
    )
    const { user } = renderRoute('/login')
    await user.type(
      await screen.findByRole('textbox', { name: 'Correo' }),
      'laura.mendez@example.com',
    )
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(await within(loginForm()).findByRole('alert')).toHaveTextContent(
      'El correo o la contraseña no coinciden. Te quedan 3 intentos antes de que la cuenta se bloquee por 15 minutos.',
    )
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Contraseña')).toHaveValue('')
    // The cleared password gets the focus back so the user can type it again.
    expect(screen.getByLabelText('Contraseña')).toHaveFocus()
    expect(vi.mocked(login).mock.calls[0]?.[0]).toEqual({
      email: 'laura.mendez@example.com',
      password: 'incorrecta',
    })
  })

  it('continues to the MFA step with the challenge', async () => {
    vi.mocked(login).mockResolvedValue({
      mfaRequired: true,
      challengeId: 'CH-9',
      expiresAt: '2026-10-02T15:37:00Z',
      methods: ['totp', 'sms', 'backup_code'],
    })
    const { user, router } = renderRoute({
      pathname: '/login',
      state: { from: '/supervision/auditoria' },
    })
    await user.type(
      await screen.findByRole('textbox', { name: 'Correo' }),
      'laura.mendez@example.com',
    )
    await user.type(screen.getByLabelText('Contraseña'), 'secreta')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Confirma que eres tú' }),
    ).toBeInTheDocument()
    expect(router.state.location.state).toEqual({
      challengeId: 'CH-9',
      email: 'laura.mendez@example.com',
      from: '/supervision/auditoria',
    })
  })

  it('goes to the locked screen when the account is locked', async () => {
    vi.mocked(login).mockRejectedValue(
      ApiProblem.fromResponse(423, {
        code: 'account_locked',
        unlockAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    )
    const { user, router } = renderRoute('/login')
    await user.type(
      await screen.findByRole('textbox', { name: 'Correo' }),
      'laura.mendez@example.com',
    )
    await user.type(screen.getByLabelText('Contraseña'), 'x')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Tu cuenta está bloqueada por 15 minutos',
      }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login/bloqueada')
  })
})

describe('MFA (BoMfa)', () => {
  it('sends users without a challenge back to the login', async () => {
    const { router } = renderRoute('/login/verificacion')
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('renders the normal state: the email and the authenticator app code only', async () => {
    renderRoute(mfaEntry)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Confirma que eres tú' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/laura\.mendez@example\.com/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Código de 6 dígitos' })).toBeInTheDocument()
    expect(
      screen.getByText('Escribe el código de 6 dígitos de tu aplicación de autenticación.'),
    ).toBeInTheDocument()
    expect(screen.getByText('El código cambia cada 30 segundos.')).toBeInTheDocument()
    // Nothing sends an SMS or issues backup codes: no "Otro método" chips.
    expect(screen.queryByRole('radiogroup', { name: 'Otro método' })).not.toBeInTheDocument()
    expect(screen.queryByText(/SMS|respaldo/)).not.toBeInTheDocument()
  })

  it('asks for the six digits before calling the API', async () => {
    const { user } = renderRoute(mfaEntry)
    await user.click(await screen.findByRole('button', { name: 'Entrar' }))
    expect(screen.getByText('Escribe los 6 dígitos.')).toBeInTheDocument()
    expect(verifyMfa).not.toHaveBeenCalled()
    const first = screen.getByRole('textbox', { name: 'Dígito 1' })
    expect(first).toHaveFocus()
    expect(first).toHaveAccessibleDescription('Escribe los 6 dígitos.')
  })

  it('shows the error state when the code is rejected (BoMfaError)', async () => {
    vi.mocked(verifyMfa).mockRejectedValue(
      ApiProblem.fromResponse(401, { code: 'mfa_invalid', remainingAttempts: 2 }),
    )
    const { user } = renderRoute(mfaEntry)
    await user.click(await screen.findByRole('textbox', { name: 'Dígito 1' }))
    await user.keyboard('123456')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    const alert = await within(screen.getByRole('form', { name: 'Segundo factor' })).findByRole(
      'alert',
    )
    expect(alert).toHaveTextContent('El código no es válido o ya venció.')
    expect(alert).toHaveTextContent('Te quedan 2 intentos.')
    expect(alert).not.toHaveTextContent('otro método')
    // The code is cleared and the first box gets the focus back.
    expect(screen.getByRole('textbox', { name: 'Dígito 1' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Dígito 1' })).toHaveFocus()
    expect(vi.mocked(verifyMfa).mock.calls[0]?.[0]).toEqual({
      challengeId: 'CH-1',
      code: '123456',
      method: 'totp',
    })
  })

  it('signs in and lands on the requested page', async () => {
    vi.mocked(verifyMfa).mockResolvedValue({
      token: 'tkn-ok',
      tokenType: 'Bearer',
      session: { id: 'SES-1', expiresAt: '2026-10-02T23:00:00Z' },
      staff: supervisorStaff,
    })
    const { user, router } = renderRoute({
      ...mfaEntry,
      state: { ...mfaEntry.state, from: '/supervision/auditoria' },
    })
    await user.click(await screen.findByRole('textbox', { name: 'Dígito 1' }))
    await user.paste('000000')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Auditoría' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/supervision/auditoria')
    expect(sessionToken.get()).toBe('tkn-ok')
  })

  it('restarts from the password when the challenge expired', async () => {
    vi.mocked(verifyMfa).mockRejectedValue(
      ApiProblem.fromResponse(401, { code: 'mfa_challenge_invalid' }),
    )
    const { user, router } = renderRoute(mfaEntry)
    await user.click(await screen.findByRole('textbox', { name: 'Dígito 1' }))
    await user.paste('000000')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(
      await screen.findByText('Tu ingreso venció. Escribe otra vez tu correo y contraseña.'),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})

/**
 * findBy* resolves as soon as the DOM shows the countdown, but the countdown's
 * interval is a passive effect that React may flush a task later. Wait (in real
 * time) until it is registered on the fake clock before advancing it.
 */
async function untilCountdownIsTicking() {
  for (let i = 0; i < 50 && vi.getTimerCount() === 0; i += 1) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)))
  }
  expect(vi.getTimerCount()).toBe(1)
}

describe('locked (BoLocked)', () => {
  beforeEach(() => {
    // Freeze only the clock and the countdown's interval: real elapsed time (lazy
    // route loading) must not leak into the countdown, while React's scheduler and
    // findBy* (MutationObserver + real setTimeout) keep running for real.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-02T15:32:28Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts down and then offers to sign in again', async () => {
    renderRoute({
      pathname: '/login/bloqueada',
      state: { email: 'laura.mendez@example.com', unlockAt: '2026-10-02T15:47:00Z' },
    })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Tu cuenta está bloqueada por 15 minutos',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Hubo 5 intentos fallidos para laura\.mendez@example\.com/),
    ).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('14:32')
    // No self-service reset: Administración unlocks it, and then she can sign in at once.
    expect(
      screen.getByText(
        /Pide a Administración que desbloquee tu cuenta o te envíe un enlace para restablecer tu contraseña\./,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al ingreso' })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(screen.queryByRole('button', { name: /Restablecer|Microsoft/ })).not.toBeInTheDocument()
    // Only what the audit records: no device or location claims.
    expect(
      screen.getByText('Los intentos quedaron registrados en la auditoría.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/dispositivo|ubicación/)).not.toBeInTheDocument()
    await untilCountdownIsTicking()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByRole('timer')).toHaveTextContent('14:31')

    act(() => {
      vi.setSystemTime(new Date('2026-10-02T15:47:01Z'))
      vi.advanceTimersByTime(1000)
    })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Ya puedes volver a intentar' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver a entrar' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('link', { name: 'Volver al ingreso' })).not.toBeInTheDocument()
  })

  it('renders without countdown when the unlock time is unknown', async () => {
    renderRoute('/login/bloqueada')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Tu cuenta está bloqueada por 15 minutos',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al ingreso' })).toHaveAttribute(
      'href',
      '/login',
    )
  })
})
