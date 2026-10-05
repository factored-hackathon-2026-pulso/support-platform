import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Callout, CodeInput, Dialog, type CodeInputHandle } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
import { useBuilderStatus } from '../hooks/use-automation'

export interface StepUpDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  title: ReactNode
  description?: ReactNode
  /** What the decision is ("Aprobar", "Publicar", "Activar agente"). */
  confirmLabel: string
  /** More fields before the code (a reason, the yardstick warning). */
  children?: ReactNode
  /** The decision is on its way. */
  pending: boolean
  /** Why the last attempt failed, in words (a wrong code, the account locked, a refusal). */
  error: string | null
  /** The decision cannot be sent yet (a required field before the code). */
  confirmDisabled?: boolean
  onConfirm(code: string): void
}

/**
 * The second factor of a builder decision (slice 16 §3): a fresh code from her authenticator app,
 * asked in the dialog of each decision and never remembered. A wrong code clears the boxes and
 * says how many attempts are left; the account locks after five.
 */
export function StepUpDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  children,
  pending,
  error,
  confirmDisabled = false,
  onConfirm,
}: StepUpDialogProps) {
  const { t } = useTranslation('automation')
  const digits = useBuilderStatus().data?.stepUpDigits ?? 6
  const [code, setCode] = useState('')
  const [incomplete, setIncomplete] = useState(false)
  const codeRef = useRef<CodeInputHandle>(null)
  const hintId = useId()
  const formId = useId()

  // A failed attempt: the code is spent, the boxes start over (and take the focus).
  const [shownError, setShownError] = useState(error)
  if (error !== shownError) {
    setShownError(error)
    if (error) setCode('')
  }
  useEffect(() => {
    if (error) codeRef.current?.focus(0)
  }, [error])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (code.length !== digits) {
      setIncomplete(true)
      codeRef.current?.focus()
      return
    }
    onConfirm(code)
  }

  const showIncomplete = incomplete && code.length !== digits
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next)
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('stepUp.cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {children}
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <div className="flex flex-col gap-2">
          <span className="text-14 font-semibold">{t('stepUp.title')}</span>
          <span className="text-13 text-ink-2">{t('stepUp.description')}</span>
          <CodeInput
            ref={codeRef}
            label={t('stepUp.code', { length: digits })}
            length={digits}
            value={code}
            onChange={(next) => {
              setCode(next)
              setIncomplete(false)
            }}
            invalid={error !== null || showIncomplete}
            describedBy={hintId}
            disabled={pending}
          />
          <span id={hintId} className="text-13 text-muted">
            {showIncomplete ? t('stepUp.incomplete', { length: digits }) : t('stepUp.hint')}
          </span>
        </div>
      </form>
    </Dialog>
  )
}
