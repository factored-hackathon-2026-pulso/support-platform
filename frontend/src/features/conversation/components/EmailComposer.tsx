import { useId, useRef, useState, type FormEvent } from 'react'
import { Info, Paperclip, Send } from 'lucide-react'
import { Button, ComposerFrame, Input, Textarea, Tooltip } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
import { MASKED_ADDRESS, describeWriteFailure, replySubject } from '../channels'
import { useEmailReply } from '../hooks'
import { newClientMessageId } from '../hooks/use-send-message'
import { MAX_MESSAGE_LENGTH, normalizeMessage } from '../model'
import type { Language } from '../types'

const MAX_SUBJECT_LENGTH = 200

export interface EmailComposerProps {
  caseId: string
  language: Language
  customerName: string
  /** The thread's subject; null when the case has no email yet (the subject is then asked). */
  subject: string | null
}

/**
 * The email reply (slice 12, canvas "correo"): "Para" (the address is hidden), "Asunto"
 * ("Re: …", or a field when the case has no email yet), the reply, "El saludo y la firma se
 * agregan solos", attach (not yet: "Pronto") and "Enviar correo".
 */
export function EmailComposer({ caseId, language, customerName, subject }: EmailComposerProps) {
  const { t } = useTranslation('conversation')
  const id = useId()
  const reply = useEmailReply(caseId, language)
  const [body, setBody] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const key = useRef<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const text = normalizeMessage(body)
  const subjectValue = subject ? null : newSubject.trim()
  const ready =
    text !== null &&
    text.length <= MAX_MESSAGE_LENGTH &&
    (subject !== null || Boolean(subjectValue)) &&
    !reply.isPending

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || !text) return
    key.current ??= newClientMessageId()
    reply.mutate(
      { body: text, subject: subjectValue || null, clientMessageId: key.current },
      {
        onSuccess: () => {
          key.current = null
          setBody('')
          setNewSubject('')
          bodyRef.current?.focus()
        },
      },
    )
  }

  function edited() {
    key.current = null
    if (reply.isError) reply.reset()
  }

  return (
    <form onSubmit={submit} aria-label={t('email.form')}>
      <ComposerFrame className="flex flex-col gap-2 px-3 py-2.5">
        <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-13">
          <dt className="text-muted">{t('email.to')}</dt>
          <dd className="m-0 flex min-w-0 items-center gap-2 text-ink">
            <span className="truncate">{customerName}</span>
            <span className="font-mono text-12 text-muted" title={t('email.hidden')}>
              <span aria-hidden="true">{MASKED_ADDRESS}</span>
              <span className="sr-only">{t('email.hiddenSr')}</span>
            </span>
          </dd>
          <dt className="text-muted">
            {subject ? (
              t('email.subject')
            ) : (
              <label htmlFor={`${id}-subject`}>{t('email.subject')}</label>
            )}
          </dt>
          <dd className="m-0 min-w-0 text-ink">
            {subject ? (
              <span className="block truncate">{replySubject(subject)}</span>
            ) : (
              <Input
                id={`${id}-subject`}
                size="sm"
                maxLength={MAX_SUBJECT_LENGTH}
                value={newSubject}
                required
                onChange={(event) => {
                  setNewSubject(event.target.value)
                  edited()
                }}
              />
            )}
          </dd>
        </dl>
        <label htmlFor={id} className="sr-only">
          {t('email.body')}
        </label>
        <Textarea
          ref={bodyRef}
          id={id}
          variant="bare"
          rows={3}
          placeholder={t('email.placeholder')}
          aria-describedby={`${id}-hint`}
          value={body}
          onChange={(event) => {
            setBody(event.target.value)
            edited()
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span id={`${id}-hint`} className="inline-flex items-center gap-1.5 text-12 text-muted">
            <Info size={13} aria-hidden="true" />
            {t('email.signature')}
          </span>
          <span className="flex items-center gap-2">
            <Tooltip content={t('email.soon')} focusable={false}>
              <button
                type="button"
                aria-label={t('email.attach')}
                aria-disabled="true"
                className="flex size-10 cursor-not-allowed items-center justify-center rounded-10 border border-border bg-subtle text-muted"
              >
                <Paperclip size={16} aria-hidden="true" />
              </button>
            </Tooltip>
            <Button
              type="submit"
              variant="primary"
              loading={reply.isPending}
              iconEnd={<Send size={15} aria-hidden="true" />}
              aria-disabled={!ready || undefined}
            >
              {t('email.send')}
            </Button>
          </span>
        </div>
      </ComposerFrame>
      {reply.isError ? (
        <p role="alert" className="m-0 mt-1.5 text-12 font-medium text-danger-strong">
          {describeWriteFailure(reply.error)}
        </p>
      ) : null}
    </form>
  )
}
