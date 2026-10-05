import { useRef, useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { PATHS } from '@/app/paths'
import { Button, Callout, DocumentTitle, Fact, LinkButton } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
import {
  describeOnboardingFailure,
  firstName,
  firstPasswordField,
  passwordChecks,
  passwordReady,
} from '../model'
import { useCompletePasswordReset, usePasswordResetCheck } from '../hooks/use-onboarding'
import type { PasswordResetCheck } from '../types'
import { LinkInvalid } from './LinkInvalid'
import { CheckFailed, CheckingLink } from './OnboardingStatus'
import { PasswordFields } from './PasswordFields'

export interface PasswordResetScreenProps {
  /** `?token=` of the reset link (null: none, the invalid screen). */
  token: string | null
}

/**
 * "Crea una contraseña nueva" (part 4, same look as BoActivar step 1): the link an
 * administrator sent. Her second factor does not change. Single use, one hour.
 */
export function PasswordResetScreen({ token }: PasswordResetScreenProps) {
  const check = usePasswordResetCheck(token)
  if (token === null) return <LinkInvalid kind="reset" />
  if (check.isPending) return <CheckingLink />
  if (check.isError) {
    const failure = describeOnboardingFailure(check.error)
    if (failure.kind === 'invalid') return <LinkInvalid kind="reset" />
    return (
      <CheckFailed
        message={failure.message}
        retrying={check.isFetching}
        onRetry={() => void check.refetch()}
      />
    )
  }
  return <ResetForm token={token} reset={check.data} />
}

function ResetForm({ token, reset }: { token: string; reset: PasswordResetCheck }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [state, setState] = useState<'form' | 'done' | 'invalid'>('form')
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const complete = useCompletePasswordReset(token)
  const owner = { email: reset.email, name: reset.name }
  const checks = passwordChecks(password, confirmation, owner)
  const ready = passwordReady(checks)
  const { t } = useTranslation(['onboarding', 'common'])

  if (state === 'invalid') return <LinkInvalid kind="reset" />
  if (state === 'done') return <PasswordUpdated />

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    if (!ready) {
      ;(firstPasswordField(checks) === 'password' ? passwordRef : confirmationRef).current?.focus()
      return
    }
    complete.mutate(password, {
      onSuccess: () => setState('done'),
      onError: (error) => {
        const failure = describeOnboardingFailure(error)
        if (failure.kind === 'invalid') return setState('invalid')
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
        <DocumentTitle title={t('reset.title')} />
        <h1 className="m-0 font-display text-30 font-bold text-balance">{t('reset.title')}</h1>
        <p className="m-0 text-15 leading-[1.5] text-ink-2">
          {t('reset.greeting', { name: firstName(reset.name) })}
        </p>
        <Fact icon="mail" text={reset.email} label={t('common:fields.email')} />
      </div>
      <form
        noValidate
        aria-label={t('reset.form')}
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
          loading={complete.isPending}
        >
          {t('reset.submit')}
        </Button>
      </form>
      <p className="m-0 text-13 leading-[1.5] text-muted">{t('password.nobodyKnows')}</p>
    </>
  )
}

function PasswordUpdated() {
  const { t } = useTranslation(['onboarding', 'common'])
  return (
    <>
      <DocumentTitle title={t('reset.doneTitle')} />
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-16 bg-success-soft text-success-strong"
      >
        <Check size={28} strokeWidth={2.2} />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-30 font-bold text-balance">{t('reset.doneTitle')}</h1>
        <p className="m-0 text-15 leading-[1.5] text-ink-2">{t('reset.doneText')}</p>
      </div>
      <LinkButton to={PATHS.login} variant="primary" size="lg" block>
        {t('common:actions.signIn')}
      </LinkButton>
    </>
  )
}
