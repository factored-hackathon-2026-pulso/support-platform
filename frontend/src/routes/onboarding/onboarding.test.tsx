import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as OnboardingApi from '@/features/onboarding/api'
import {
  activateInvitation,
  checkInvitation,
  checkPasswordReset,
  completePasswordReset,
  fetchDevMailbox,
  fetchMeta,
  setInvitationPassword,
} from '@/features/onboarding/api'
import { ApiProblem } from '@/lib/api'
import { adminStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'

vi.mock('@/features/onboarding/api', async (importOriginal) => {
  const actual = await importOriginal<typeof OnboardingApi>()
  return {
    ...actual,
    checkInvitation: vi.fn<typeof actual.checkInvitation>(),
    setInvitationPassword: vi.fn<typeof actual.setInvitationPassword>(),
    activateInvitation: vi.fn<typeof actual.activateInvitation>(),
    checkPasswordReset: vi.fn<typeof actual.checkPasswordReset>(),
    completePasswordReset: vi.fn<typeof actual.completePasswordReset>(),
    fetchMeta: vi.fn<typeof actual.fetchMeta>(),
    fetchDevMailbox: vi.fn<typeof actual.fetchDevMailbox>(),
  }
})

const RULES = { minLength: 12, maxLength: 128, rules: ['min_length', 'personal_info', 'common'] }
const invitation = {
  name: 'Bruna Esteves',
  email: 'bruna.esteves@latambank.example',
  roles: ['analyst' as const],
  teamName: 'Equipo Andes',
  expiresAt: '2026-10-05T10:12:00Z',
  passwordRules: RULES as never,
}
const enrollment = {
  otpauthUri:
    'otpauth://totp/LATAM%20Bank%20CC:bruna.esteves%40latambank.example?secret=JBSWY3DPEHPK3PXP&issuer=LATAM%20Bank%20CC',
  secret: 'JBSWY3DPEHPK3PXP',
  accountName: 'bruna.esteves@latambank.example',
  issuer: 'LATAM Bank CC',
  digits: 6,
  periodSeconds: 30,
}
const linkInvalid = () => new ApiProblem({ status: 410, code: 'link_invalid' })

beforeEach(() => {
  vi.mocked(checkInvitation).mockReset()
  vi.mocked(setInvitationPassword).mockReset()
  vi.mocked(activateInvitation).mockReset()
  vi.mocked(checkPasswordReset).mockReset()
  vi.mocked(completePasswordReset).mockReset()
  vi.mocked(fetchMeta).mockResolvedValue({
    name: 'cc-platform',
    version: '0.1.0',
    build: 'test',
    environment: 'dev',
    apiVersion: 'v1',
    devMailbox: true,
  })
  vi.mocked(fetchDevMailbox).mockReset()
})

const passwordInput = () => screen.getByLabelText('Contraseña nueva')
const confirmInput = () => screen.getByLabelText('Repite la contraseña')
const rules = () => screen.getByRole('list', { name: 'Requisitos de la contraseña' })

describe('/activar (BoActivar)', () => {
  it('walks the three steps: password, two-step setup, account ready', async () => {
    vi.mocked(checkInvitation).mockResolvedValue(invitation)
    vi.mocked(setInvitationPassword).mockResolvedValue(enrollment)
    vi.mocked(activateInvitation).mockResolvedValue({
      name: invitation.name,
      email: invitation.email,
    })
    const { user } = renderRoute('/activar?token=tok-123')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Activa tu cuenta' }),
    ).toBeInTheDocument()
    expect(checkInvitation).toHaveBeenCalledWith('tok-123', expect.anything())
    expect(
      screen.getByText(
        'Hola, Bruna. Administración te invitó a la Plataforma CC. Crea tu contraseña para empezar.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(invitation.email)).toBeInTheDocument()
    expect(screen.getByText('Analista')).toBeInTheDocument()
    expect(screen.getByText('Equipo Andes')).toBeInTheDocument()
    const steps = screen.getByRole('list', { name: 'Pasos para activar tu cuenta' })
    expect(within(steps).getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step')
    expect(within(rules()).getAllByText(': pendiente')).toHaveLength(4)

    // "Continuar" too early: no request, the first broken field gets the focus.
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(passwordInput()).toHaveFocus()
    expect(setInvitationPassword).not.toHaveBeenCalled()

    await user.type(passwordInput(), 'Bruna-Verde-27')
    expect(
      within(rules()).getByText('No incluye tu nombre ni tu correo').parentElement,
    ).toHaveTextContent(': no cumple')
    await user.clear(passwordInput())
    await user.type(passwordInput(), 'Verde-Andes-27')
    await user.type(confirmInput(), 'Verde-Andes-2')
    expect(screen.getByText('Las dos contraseñas no coinciden.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(confirmInput()).toHaveFocus()
    await user.type(confirmInput(), '7')
    expect(within(rules()).getAllByText(': cumple')).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: 'Mostrar' }))
    expect(passwordInput()).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Ocultar' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(setInvitationPassword).toHaveBeenCalledWith('tok-123', 'Verde-Andes-27')

    // Step 2: the QR, the manual key (copy) and the code.
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Configura la verificación en dos pasos',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Código QR para tu app de autenticación' })).toBeTruthy()
    expect(
      screen.getByLabelText('¿No puedes escanear? Escribe esta clave en la app:'),
    ).toHaveTextContent('JBSW Y3DP EHPK 3PXP')
    await user.click(screen.getByRole('button', { name: 'Copiar' }))
    expect(await screen.findByRole('button', { name: 'Copiada' })).toBeInTheDocument()
    await expect(navigator.clipboard.readText()).resolves.toBe('JBSWY3DPEHPK3PXP')

    await user.click(screen.getByRole('button', { name: 'Activar cuenta' }))
    expect(screen.getByText('Escribe los 6 dígitos que muestra tu app.')).toBeInTheDocument()
    expect(activateInvitation).not.toHaveBeenCalled()

    vi.mocked(activateInvitation).mockRejectedValueOnce(
      new ApiProblem({ status: 422, code: 'totp_invalid', extensions: { remainingAttempts: 4 } }),
    )
    await user.click(screen.getByRole('textbox', { name: 'Dígito 1' }))
    await user.paste('123456')
    await user.click(screen.getByRole('button', { name: 'Activar cuenta' }))
    expect(
      await screen.findByText(
        'El código no coincide. Escribe el código que muestra ahora tu app. Te quedan 4 intentos.',
      ),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Dígito 1' })).toHaveFocus())

    await user.paste('654321')
    await user.click(screen.getByRole('button', { name: 'Activar cuenta' }))
    expect(activateInvitation).toHaveBeenLastCalledWith('tok-123', '654321')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tu cuenta está lista' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Verificación en dos pasos activa')).toBeInTheDocument()
    expect(
      screen.getByText('Empiezas En pausa: pasa a Disponible cuando quieras recibir casos'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login')
  })

  it('shows "El enlace venció o ya se usó" for an unusable or missing link', async () => {
    vi.mocked(checkInvitation).mockRejectedValue(linkInvalid())
    const { unmount } = renderRoute('/activar?token=old')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'El enlace venció o ya se usó' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Los enlaces de invitación duran 48 horas y sirven una sola vez.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Pide una nueva invitación a administración')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entra con tu correo' })).toHaveAttribute(
      'href',
      '/login',
    )
    unmount()

    renderRoute('/activar')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'El enlace venció o ya se usó' }),
    ).toBeInTheDocument()
    expect(checkInvitation).toHaveBeenCalledTimes(1)
  })

  it('says until when after too many attempts, with a retry', async () => {
    vi.mocked(checkInvitation).mockRejectedValue(
      new ApiProblem({
        status: 429,
        code: 'rate_limited',
        extensions: { unlockAt: '2026-10-03T16:30:00Z' },
      }),
    )
    renderRoute('/activar?token=tok')
    expect(
      await screen.findByText('Demasiados intentos. Vuelve a intentarlo a las 11:30.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('locks the code after too many wrong ones and moves to the invalid screen if the link dies', async () => {
    vi.mocked(checkInvitation).mockResolvedValue(invitation)
    vi.mocked(setInvitationPassword).mockResolvedValue(enrollment)
    vi.mocked(activateInvitation)
      .mockRejectedValueOnce(
        new ApiProblem({
          status: 423,
          code: 'account_locked',
          extensions: { unlockAt: '2026-10-03T16:30:00Z' },
        }),
      )
      .mockRejectedValueOnce(linkInvalid())
    const { user } = renderRoute('/activar?token=tok')
    await screen.findByRole('heading', { level: 1, name: 'Activa tu cuenta' })
    await user.type(passwordInput(), 'Verde-Andes-27')
    await user.type(confirmInput(), 'Verde-Andes-27')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await screen.findByRole('heading', { level: 1, name: 'Configura la verificación en dos pasos' })
    await user.click(screen.getByRole('textbox', { name: 'Dígito 1' }))
    await user.paste('111111')
    await user.click(screen.getByRole('button', { name: 'Activar cuenta' }))
    expect(
      await screen.findByText(
        'Escribiste un código equivocado demasiadas veces. Vuelve a intentarlo a las 11:30.',
      ),
    ).toBeInTheDocument()
    await user.paste('222222')
    await user.click(screen.getByRole('button', { name: 'Activar cuenta' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'El enlace venció o ya se usó' }),
    ).toBeInTheDocument()
  })

  it('puts a rejected password back on its field', async () => {
    vi.mocked(checkInvitation).mockResolvedValue(invitation)
    vi.mocked(setInvitationPassword).mockRejectedValue(
      new ApiProblem({
        status: 422,
        code: 'password_rejected',
        extensions: { reasons: ['common'] },
      }),
    )
    const { user } = renderRoute('/activar?token=tok')
    await screen.findByRole('heading', { level: 1, name: 'Activa tu cuenta' })
    await user.type(passwordInput(), 'Verde-Andes-27')
    await user.type(confirmInput(), 'Verde-Andes-27')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await waitFor(() => expect(passwordInput()).toHaveFocus())
    expect(passwordInput()).toHaveAccessibleDescription(
      expect.stringContaining('La contraseña es una contraseña común. Elige otra.'),
    )
  })

  it('opens for a signed-in person too (outside GuestOnly)', async () => {
    vi.mocked(checkInvitation).mockResolvedValue(invitation)
    renderRoute('/activar?token=tok', { staff: adminStaff })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Activa tu cuenta' }),
    ).toBeInTheDocument()
  })
})

describe('/restablecer', () => {
  it('sets a new password once', async () => {
    vi.mocked(checkPasswordReset).mockResolvedValue({
      name: 'Tomás Arango',
      email: 'tomas.arango@latambank.example',
      expiresAt: '2026-10-03T17:00:00Z',
      passwordRules: RULES as never,
    })
    vi.mocked(completePasswordReset).mockResolvedValue({
      email: 'tomas.arango@latambank.example',
      revokedSessions: 0,
    })
    const { user } = renderRoute('/restablecer?token=rst')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Crea una contraseña nueva' }),
    ).toBeInTheDocument()
    await user.type(passwordInput(), 'Cielo-Pacifico-31')
    await user.type(confirmInput(), 'Cielo-Pacifico-31')
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }))
    expect(completePasswordReset).toHaveBeenCalledWith('rst', 'Cielo-Pacifico-31')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Contraseña actualizada' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Ya puedes entrar con tu contraseña nueva y el código de tu app.'),
    ).toBeInTheDocument()
  })

  it('shows the invalid screen for a used or expired link', async () => {
    vi.mocked(checkPasswordReset).mockRejectedValue(linkInvalid())
    renderRoute('/restablecer?token=used')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'El enlace venció o ya se usó' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Los enlaces para restablecer la contraseña duran 1 hora y sirven una sola vez.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Pide un enlace nuevo a administración')).toBeInTheDocument()
  })
})

describe('/dev/correos', () => {
  it('lists the emails with an in-app link, clearly marked as a development tool', async () => {
    vi.mocked(fetchDevMailbox).mockResolvedValue({
      items: [
        {
          id: 'EML-1',
          kind: 'invitation',
          to: invitation.email,
          subject: 'Te invitaron a la Plataforma CC de LATAM Bank',
          text: 'Hola, Bruna.\n\nAbre este enlace.',
          link: 'http://localhost:5173/activar?token=tok-xyz',
          sentAt: new Date().toISOString(),
        },
      ],
    })
    vi.mocked(checkInvitation).mockResolvedValue(invitation)
    const { user, router } = renderRoute('/dev/correos')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Correos de desarrollo' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Herramienta de desarrollo')).toBeInTheDocument()
    const item = await screen.findByRole('article', {
      name: 'Te invitaron a la Plataforma CC de LATAM Bank',
    })
    expect(within(item).getByText('Invitación')).toBeInTheDocument()
    expect(within(item).getByText(invitation.email)).toBeInTheDocument()
    await user.click(within(item).getByRole('link', { name: /Abrir enlace/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/activar'))
    expect(router.state.location.search).toBe('?token=tok-xyz')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Activa tu cuenta' }),
    ).toBeInTheDocument()
  })

  it('says when there are no emails yet', async () => {
    vi.mocked(fetchDevMailbox).mockResolvedValue({ items: [] })
    renderRoute('/dev/correos')
    expect(await screen.findByText('Todavía no hay correos')).toBeInTheDocument()
  })

  it('is not available when the backend has no dev mailbox', async () => {
    vi.mocked(fetchMeta).mockResolvedValue({
      name: 'cc-platform',
      version: '0.1.0',
      build: 'test',
      environment: 'test',
      apiVersion: 'v1',
      devMailbox: false,
    })
    renderRoute('/dev/correos')
    expect(await screen.findByRole('heading', { name: 'No disponible' })).toBeInTheDocument()
    expect(fetchDevMailbox).not.toHaveBeenCalled()
  })

  it('links to it from the login page only in dev', async () => {
    const { unmount } = renderRoute('/login')
    expect(await screen.findByRole('link', { name: 'Correos de desarrollo' })).toHaveAttribute(
      'href',
      '/dev/correos',
    )
    unmount()
    vi.mocked(fetchMeta).mockResolvedValue({
      name: 'cc-platform',
      version: '0.1.0',
      build: 'test',
      environment: 'test',
      apiVersion: 'v1',
      devMailbox: false,
    })
    renderRoute('/login')
    await screen.findByRole('heading', { level: 1, name: 'Entrar' })
    await waitFor(() => expect(fetchMeta).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('link', { name: 'Correos de desarrollo' })).not.toBeInTheDocument()
  })
})
