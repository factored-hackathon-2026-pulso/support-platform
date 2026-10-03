import { useRef, useState, type FormEvent } from 'react'
import { Button, Callout, Field, Input, useToast } from '@/components/ui'
import type { LoginResponse } from '../api'
import { useLoginMutation } from '../hooks/use-auth-mutations'
import {
  describeLoginFailure,
  FORGOT_PASSWORD_HELP,
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  validateLogin,
  type LoginErrors,
  type LoginValues,
} from '../model'
import { AuthHeading } from './AuthHeading'
import { AuthHelpFooter } from './AuthHelpFooter'
import { AuthNote } from './AuthNote'

export interface LoginScreenProps {
  /** Password accepted: continue to the MFA step. */
  onChallenge: (challenge: LoginResponse, email: string) => void
  /** Account locked (now or as a result of this attempt). */
  onLocked: (lock: { email: string; unlockAt: string | null }) => void
  /** Message carried from a previous step (e.g. the MFA challenge expired). */
  notice?: string | null
  /** Show the seeded dev accounts hint (never in production builds). */
  showDevHint?: boolean
}

/** "Entrar" (canvas BoLogin / BoLoginError): email + password, then MFA. */
export function LoginScreen({
  onChallenge,
  onLocked,
  notice = null,
  showDevHint = false,
}: LoginScreenProps) {
  const [values, setValues] = useState<LoginValues>({ email: '', password: '' })
  const [errors, setErrors] = useState<LoginErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const loginMutation = useLoginMutation()
  const { toast } = useToast()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  function update(field: keyof LoginValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validateLogin(values)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      // Focus the first invalid field: its error is read as its description.
      const firstInvalid = nextErrors.email ? emailRef.current : passwordRef.current
      firstInvalid?.focus()
      return
    }

    const email = values.email.trim()
    setFailure(null)
    loginMutation.mutate(
      { email, password: values.password },
      {
        onSuccess: (challenge) => onChallenge(challenge, email),
        onError: (error) => {
          const outcome = describeLoginFailure(error)
          setValues((current) => ({ ...current, password: '' }))
          if (outcome.kind === 'locked') {
            onLocked({ email, unlockAt: outcome.unlockAt })
            return
          }
          setFailure(outcome.message)
          // The password was cleared: put the user back in it (the alert is announced).
          passwordRef.current?.focus()
        },
      },
    )
  }

  const credentialsRejected = failure !== null

  return (
    <>
      <AuthHeading
        title="Entrar"
        subtitle="Tu rol (analista, supervisora o administración) se asigna a tu cuenta."
      />

      <form
        noValidate
        onSubmit={handleSubmit}
        aria-label="Entrar con correo"
        className="flex flex-col gap-3.5"
      >
        {failure ? <Callout tone="danger">{failure}</Callout> : null}
        {!failure && notice ? <Callout tone="warn">{notice}</Callout> : null}
        {showDevHint ? (
          <Callout tone="info" title="Entorno de desarrollo">
            Usa una cuenta sembrada (@latambank.example) con la contraseña demo1234. Datos de
            ejemplo.
          </Callout>
        ) : null}
        <Field label="Correo" error={errors.email}>
          <Input
            ref={emailRef}
            type="email"
            size="lg"
            autoComplete="username"
            placeholder="nombre.apellido@latambank.example"
            value={values.email}
            onChange={(event) => update('email', event.target.value)}
          />
        </Field>
        <Field
          label="Contraseña"
          error={errors.password}
          labelAside={
            <button
              type="button"
              className="cursor-pointer text-14 text-link"
              onClick={() =>
                toast({ title: '¿Olvidaste tu contraseña?', description: FORGOT_PASSWORD_HELP })
              }
            >
              ¿La olvidaste?
            </button>
          }
        >
          <Input
            ref={passwordRef}
            type="password"
            size="lg"
            autoComplete="current-password"
            value={values.password}
            aria-invalid={credentialsRejected || undefined}
            onChange={(event) => update('password', event.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={loginMutation.isPending}>
          Continuar
        </Button>
      </form>

      <AuthNote>
        <span>Después de la contraseña siempre pedimos el código de tu app de autenticación.</span>
        <span>
          Después de {MAX_FAILED_ATTEMPTS} intentos fallidos la cuenta se bloquea {LOCKOUT_MINUTES}{' '}
          minutos. Cada ingreso queda registrado.
        </span>
      </AuthNote>

      <AuthHelpFooter />
    </>
  )
}
