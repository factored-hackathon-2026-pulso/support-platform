import { useRef, useState, type FormEvent } from 'react'
import { Check, Copy, Mail, Smartphone } from 'lucide-react'
import {
  Badge,
  Button,
  Callout,
  CodeInput,
  DocumentTitle,
  Fact,
  LinkButton,
  type CodeInputHandle,
} from '@/components/ui'
import {
  CODE_LENGTH,
  CODE_REQUIRED_ERROR,
  describeOnboardingFailure,
  firstName,
  firstPasswordField,
  groupKey,
  passwordChecks,
  passwordReady,
  roleLabels,
  type ActivationStep,
} from '../model'
import {
  useActivateInvitation,
  useInvitationCheck,
  useSetInvitationPassword,
} from '../hooks/use-onboarding'
import type { InvitationCheck, TotpEnrollment } from '../types'
import { LinkInvalid } from './LinkInvalid'
import { CheckFailed, CheckingLink } from './OnboardingStatus'
import { PasswordFields } from './PasswordFields'
import { QrCode } from './QrCode'
import { StepIndicator } from './StepIndicator'

export interface ActivationScreenProps {
  /** `?token=` of the invitation link (null: none, the invalid screen). */
  token: string | null
}

/**
 * "Activa tu cuenta" (BoActivar.dc.html, part 4): the invitation link. Step 1 her own
 * password (live requirements), step 2 her authenticator app (QR, manual key, the first
 * 6-digit code), then "Tu cuenta está lista". An unusable link shows "El enlace venció
 * o ya se usó". The token lives in the URL only; the key is shown once (component
 * state, never stored).
 */
export function ActivationScreen({ token }: ActivationScreenProps) {
  const check = useInvitationCheck(token)
  if (token === null) return <LinkInvalid kind="invitation" />
  if (check.isPending) return <CheckingLink />
  if (check.isError) {
    const failure = describeOnboardingFailure(check.error)
    if (failure.kind === 'invalid') return <LinkInvalid kind="invitation" />
    return (
      <CheckFailed
        message={failure.message}
        retrying={check.isFetching}
        onRetry={() => void check.refetch()}
      />
    )
  }
  return <Activation token={token} invitation={check.data} />
}

function Activation({ token, invitation }: { token: string; invitation: InvitationCheck }) {
  const [step, setStep] = useState<ActivationStep>('password')
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  if (invalid) return <LinkInvalid kind="invitation" />
  if (step === 'done') return <AccountReady email={invitation.email} />

  return (
    <div className="flex flex-col gap-[22px]">
      <StepIndicator step={step} />
      {step === 'password' || enrollment === null ? (
        <PasswordStep
          token={token}
          invitation={invitation}
          notice={notice}
          onInvalid={() => setInvalid(true)}
          onDone={(result) => {
            setNotice(null)
            setEnrollment(result)
            setStep('verification')
          }}
        />
      ) : (
        <VerificationStep
          token={token}
          enrollment={enrollment}
          onInvalid={() => setInvalid(true)}
          onRestart={(message) => {
            setEnrollment(null)
            setNotice(message)
            setStep('password')
          }}
          onDone={() => setStep('done')}
        />
      )}
    </div>
  )
}

// ── Step 1: her password ─────────────────────────────────────────────────────

function PasswordStep({
  token,
  invitation,
  notice,
  onInvalid,
  onDone,
}: {
  token: string
  invitation: InvitationCheck
  notice: string | null
  onInvalid(): void
  onDone(enrollment: TotpEnrollment): void
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const submit = useSetInvitationPassword(token)
  const owner = { email: invitation.email, name: invitation.name }
  const checks = passwordChecks(password, confirmation, owner)
  const ready = passwordReady(checks)

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    if (!ready) {
      const field = firstPasswordField(checks)
      ;(field === 'password' ? passwordRef : confirmationRef).current?.focus()
      return
    }
    submit.mutate(password, {
      onSuccess: onDone,
      onError: (error) => {
        const failure = describeOnboardingFailure(error)
        if (failure.kind === 'invalid') return onInvalid()
        if (failure.kind === 'message' && failure.field === 'password') {
          setPasswordError(failure.message)
          passwordRef.current?.focus()
          return
        }
        setFormError(failure.message)
      },
    })
  }

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <DocumentTitle title="Activa tu cuenta" />
        <h1 className="m-0 font-display text-30 font-bold text-balance">Activa tu cuenta</h1>
        <p className="m-0 text-15 leading-[1.5] text-ink-2">
          Hola, {firstName(invitation.name)}. Administración te invitó a la Plataforma CC. Crea tu
          contraseña para empezar.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-14 text-ink-2">
          <Fact icon="mail" text={invitation.email} label="Correo" />
          <span className="flex items-center gap-1">
            <span className="sr-only">Rol: </span>
            {roleLabels(invitation.roles).map((role) => (
              <Badge key={role} tone="neutral" size="sm">
                {role}
              </Badge>
            ))}
          </span>
          <Fact icon="users" text={invitation.teamName} label="Equipo" />
        </div>
      </div>
      {notice ? <Callout tone="warn">{notice}</Callout> : null}
      <form
        noValidate
        aria-label="Crear contraseña"
        className="flex flex-col gap-3.5"
        onSubmit={onSubmit}
      >
        {formError ? <Callout tone="danger">{formError}</Callout> : null}
        <PasswordFields
          password={password}
          confirmation={confirmation}
          owner={owner}
          passwordError={passwordError}
          passwordRef={passwordRef}
          confirmationRef={confirmationRef}
          onPasswordChange={(value) => {
            setPassword(value)
            setPasswordError(null)
          }}
          onConfirmationChange={setConfirmation}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          aria-disabled={!ready || undefined}
          className={ready ? undefined : 'opacity-50'}
          loading={submit.isPending}
        >
          Continuar
        </Button>
      </form>
      <p className="m-0 text-13 leading-[1.5] text-muted">
        Nadie del banco conoce tu contraseña: ni administración ni supervisión pueden verla.
      </p>
    </>
  )
}

// ── Step 2: her authenticator app ────────────────────────────────────────────

function VerificationStep({
  token,
  enrollment,
  onInvalid,
  onRestart,
  onDone,
}: {
  token: string
  enrollment: TotpEnrollment
  onInvalid(): void
  onRestart(message: string): void
  onDone(): void
}) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const codeRef = useRef<CodeInputHandle>(null)
  const activate = useActivateInvitation(token)
  const errorId = 'activation-code-error'
  const key = groupKey(enrollment.secret)

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    if (code.length < CODE_LENGTH) {
      setError(CODE_REQUIRED_ERROR)
      codeRef.current?.focus()
      return
    }
    activate.mutate(code, {
      onSuccess: onDone,
      onError: (problem) => {
        const failure = describeOnboardingFailure(problem)
        if (failure.kind === 'invalid') return onInvalid()
        if (failure.kind === 'restart') return onRestart(failure.message)
        if (failure.field === 'code') {
          setError(failure.message)
          setCode('')
          codeRef.current?.focus(0)
          return
        }
        setFormError(failure.message)
      },
    })
  }

  function copyKey() {
    void navigator.clipboard?.writeText(enrollment.secret).then(
      () => setCopied(true),
      () => undefined,
    )
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <DocumentTitle title="Configura la verificación en dos pasos" />
        <h1 className="m-0 font-display text-30 font-bold text-balance">
          Configura la verificación en dos pasos
        </h1>
        <p className="m-0 text-15 leading-[1.5] text-ink-2">
          Cada vez que entres te pediremos un código de tu app de autenticación, además de tu
          contraseña.
        </p>
      </div>
      <div className="flex items-start gap-5">
        <QrCode value={enrollment.otpauthUri} label="Código QR para tu app de autenticación" />
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0 text-14 leading-[1.4] text-ink-2">
          {[
            'Abre tu app de autenticación en el teléfono.',
            'Agrega una cuenta y escanea el código.',
            `Escribe abajo el código de ${CODE_LENGTH} dígitos que te muestra.`,
          ].map((text, index) => (
            <li key={text} className="flex gap-2">
              <span
                aria-hidden="true"
                className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-panel text-12 font-bold text-ink"
              >
                {index + 1}
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col gap-1.5">
        <span id="setup-key-label" className="text-13 text-ink-2">
          ¿No puedes escanear? Escribe esta clave en la app:
        </span>
        <div className="flex items-center justify-between gap-3 rounded-10 border border-border bg-subtle py-2 pr-2 pl-3.5">
          <span
            aria-labelledby="setup-key-label"
            className="font-mono text-16 font-medium tracking-[0.04em] select-all"
          >
            {key}
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon={
              copied ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )
            }
            onClick={copyKey}
          >
            {copied ? 'Copiada' : 'Copiar'}
          </Button>
        </div>
      </div>
      <form
        noValidate
        aria-label="Confirmar el código"
        className="flex flex-col gap-3.5"
        onSubmit={onSubmit}
      >
        {formError ? <Callout tone="danger">{formError}</Callout> : null}
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-14 font-semibold">Código de 6 dígitos</legend>
          <CodeInput
            ref={codeRef}
            value={code}
            onChange={(value) => {
              setCode(value)
              setError(null)
            }}
            length={CODE_LENGTH}
            label="Código de 6 dígitos"
            describedBy={error ? errorId : undefined}
            invalid={error !== null}
          />
          {error ? (
            <span id={errorId} role="alert" className="text-13 font-medium text-danger-strong">
              {error}
            </span>
          ) : null}
        </fieldset>
        <Button type="submit" variant="primary" size="lg" block loading={activate.isPending}>
          Activar cuenta
        </Button>
      </form>
      <p className="m-0 text-13 leading-[1.5] text-muted">
        Sirve cualquier app de autenticación, como Google Authenticator o Microsoft Authenticator.
        Si cambias de teléfono, pide ayuda a administración.
      </p>
    </>
  )
}

// ── Done ─────────────────────────────────────────────────────────────────────

function AccountReady({ email }: { email: string }) {
  return (
    <>
      <DocumentTitle title="Tu cuenta está lista" />
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-16 bg-success-soft text-success-strong"
      >
        <Check size={28} strokeWidth={2.2} />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-30 font-bold text-balance">Tu cuenta está lista</h1>
        <p className="m-0 text-15 leading-[1.5] text-ink-2">
          Desde ahora entras con tu correo, tu contraseña y el código de tu app.
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 rounded-12 bg-panel px-4 py-3.5 text-14 text-ink-2">
        <li className="flex items-center gap-2.5">
          <Mail size={16} aria-hidden="true" className="shrink-0 text-muted" />
          {email}
        </li>
        <li className="flex items-center gap-2.5">
          <Smartphone size={16} aria-hidden="true" className="shrink-0 text-muted" />
          Verificación en dos pasos activa
        </li>
        <li className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex w-4 justify-center">
            <span className="size-2 rounded-full bg-warn" />
          </span>
          Empiezas En pausa: pasa a Disponible cuando quieras recibir casos
        </li>
      </ul>
      <LinkButton to="/login" variant="primary" size="lg" block>
        Entrar
      </LinkButton>
    </>
  )
}
