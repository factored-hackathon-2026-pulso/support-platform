import { useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { PATHS } from '@/app/paths'
import { Button, Callout, CodeInput, type CodeInputHandle } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
import type { SessionResponse } from '../api'
import { useVerifyMfaMutation } from '../hooks/use-auth-mutations'
import { describeMfaFailure, isCompleteCode, MFA_CODE_LENGTH, MFA_METHOD } from '../model'
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
  const { t } = useTranslation(['auth', 'common'])

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
    incomplete && !isCompleteCode(code)
      ? t('mfa.incomplete', { length: MFA_CODE_LENGTH })
      : t('mfa.hint')

  return (
    <>
      <AuthHeading
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-x-3 text-14 text-ink-2">
            <span>{email}</span>
            <Link to={PATHS.login} replace className="text-link">
              {t('mfa.notMe')}
            </Link>
          </span>
        }
        title={t('mfa.title')}
        subtitle={t('mfa.instructions')}
      />

      <form
        noValidate
        onSubmit={handleSubmit}
        aria-label={t('mfa.form')}
        className="flex flex-col gap-6"
      >
        {failure ? <Callout tone="danger">{failure}</Callout> : null}
        {showDevHint ? (
          <Callout tone="info" title={t('login.devTitle')}>
            {t('mfa.devHint')}
          </Callout>
        ) : null}
        <div className="flex flex-col gap-2">
          <CodeInput
            ref={codeRef}
            label={t('mfa.code', { length: MFA_CODE_LENGTH })}
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
          {t('mfa.submit')}
        </Button>
      </form>
    </>
  )
}
