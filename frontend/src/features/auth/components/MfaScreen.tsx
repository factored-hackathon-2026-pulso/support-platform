import { useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button, Callout, CodeInput, type CodeInputHandle } from '@/components/ui'
import type { SessionResponse } from '../api'
import { useVerifyMfaMutation } from '../hooks/use-auth-mutations'
import {
  DEV_MFA_HINT,
  describeMfaFailure,
  isCompleteCode,
  MFA_CODE_LENGTH,
  MFA_HINT,
  MFA_INSTRUCTIONS,
  MFA_METHOD,
} from '../model'
import { AuthHeading } from './AuthHeading'

export interface MfaScreenProps {
  challengeId: string
  email: string
  /** Code accepted: store the session (the guards then redirect). */
  onSignedIn: (session: SessionResponse) => void
  onLocked: (lock: { email: string; unlockAt: string | null }) => void
  /** Challenge expired: back to the password step with a message. */
  onRestart: (message: string) => void
  /** Show the dev-mode hint with the fixed code (never in production builds). */
  showDevHint?: boolean
}

/**
 * "Confirma que eres tú" (canvas BoMfa / BoMfaError): the 6-digit code of the
 * authenticator app. The canvas "Otro método" chips (SMS, backup code) are left
 * out: nothing sends an SMS or issues backup codes in this product.
 */
export function MfaScreen({
  challengeId,
  email,
  onSignedIn,
  onLocked,
  onRestart,
  showDevHint = false,
}: MfaScreenProps) {
  const [code, setCode] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [incomplete, setIncomplete] = useState(false)
  const verifyMutation = useVerifyMfaMutation()
  const hintId = useId()
  const codeRef = useRef<CodeInputHandle>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isCompleteCode(code)) {
      setIncomplete(true)
      codeRef.current?.focus()
      return
    }
    setFailure(null)
    verifyMutation.mutate(
      { challengeId, code, method: MFA_METHOD },
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
    incomplete && !isCompleteCode(code) ? `Escribe los ${MFA_CODE_LENGTH} dígitos.` : MFA_HINT

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
        subtitle={MFA_INSTRUCTIONS}
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
            {DEV_MFA_HINT}
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
    </>
  )
}
