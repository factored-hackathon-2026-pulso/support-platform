import { useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button, Callout, CodeInput, SegmentedControl, type CodeInputHandle } from '@/components/ui'
import type { SessionResponse } from '../api'
import { useVerifyMfaMutation } from '../hooks/use-auth-mutations'
import {
  availableMfaMethods,
  describeMfaFailure,
  isCompleteCode,
  MFA_CODE_LENGTH,
  type MfaMethodId,
} from '../model'
import { AuthHeading } from './AuthHeading'

export interface MfaScreenProps {
  challengeId: string
  email: string
  /** Methods allowed for this challenge (from the login response). Default: all. */
  methods?: readonly MfaMethodId[]
  /** Code accepted: store the session (the guards then redirect). */
  onSignedIn: (session: SessionResponse) => void
  onLocked: (lock: { email: string; unlockAt: string | null }) => void
  /** Challenge expired: back to the password step with a message. */
  onRestart: (message: string) => void
  /** Show the dev-mode hint with the fixed code (never in production builds). */
  showDevHint?: boolean
}

/** "Confirma que eres tú" (canvas BoMfa / BoMfaError): 6-digit second factor. */
export function MfaScreen({
  challengeId,
  email,
  methods,
  onSignedIn,
  onLocked,
  onRestart,
  showDevHint = false,
}: MfaScreenProps) {
  const [code, setCode] = useState('')
  const options = availableMfaMethods(methods)
  const [method, setMethod] = useState<MfaMethodId>(() => options[0]?.id ?? 'totp')
  const [failure, setFailure] = useState<string | null>(null)
  const [incomplete, setIncomplete] = useState(false)
  const verifyMutation = useVerifyMfaMutation()
  const hintId = useId()
  const codeRef = useRef<CodeInputHandle>(null)
  const current = options.find((item) => item.id === method) ?? options[0]

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isCompleteCode(code)) {
      setIncomplete(true)
      codeRef.current?.focus()
      return
    }
    setFailure(null)
    verifyMutation.mutate(
      { challengeId, code, method },
      {
        onSuccess: onSignedIn,
        onError: (error) => {
          const outcome = describeMfaFailure(error)
          if (outcome.kind === 'locked') onLocked({ email, unlockAt: outcome.unlockAt })
          else if (outcome.kind === 'restart') onRestart(outcome.message)
          else {
            setFailure(outcome.message)
            setCode('')
            codeRef.current?.focus(0)
          }
        },
      },
    )
  }

  const hint =
    incomplete && !isCompleteCode(code)
      ? `Escribe los ${MFA_CODE_LENGTH} dígitos.`
      : (current?.hint ?? '')

  return (
    <>
      <AuthHeading
        eyebrow={
          <span className="text-14 text-ink-2">
            {email} ·{' '}
            <Link to="/login" replace className="text-link">
              No soy yo
            </Link>
          </span>
        }
        title="Confirma que eres tú"
        subtitle={current?.instructions}
      />

      <form
        noValidate
        onSubmit={handleSubmit}
        aria-label="Segundo factor"
        className="flex flex-col gap-6"
      >
        {failure ? <Callout tone="danger">{failure}</Callout> : null}
        {showDevHint ? (
          <Callout tone="info" title="Entorno de desarrollo">
            El código de prueba es 000000.
          </Callout>
        ) : null}
        <div className="flex flex-col gap-2">
          <CodeInput
            ref={codeRef}
            label={`Código de ${MFA_CODE_LENGTH} dígitos`}
            length={MFA_CODE_LENGTH}
            value={code}
            onChange={(next) => {
              setCode(next)
              if (failure) setFailure(null)
            }}
            invalid={failure !== null || (incomplete && !isCompleteCode(code))}
            describedBy={hintId}
            initialFocus
          />
          <span id={hintId} className="text-13 text-muted">
            {hint}
          </span>
        </div>
        <Button type="submit" variant="primary" size="lg" block loading={verifyMutation.isPending}>
          Entrar
        </Button>
      </form>

      {options.length > 1 ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3.5">
          <span aria-hidden="true" className="text-13 font-semibold text-ink-2">
            Otro método
          </span>
          <SegmentedControl
            label="Otro método"
            variant="pills"
            options={options.map((item) => ({ value: item.id, label: item.label }))}
            value={method}
            onValueChange={(next) => {
              setMethod(next)
              setCode('')
              setFailure(null)
            }}
          />
        </div>
      ) : null}
    </>
  )
}
