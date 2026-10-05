import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { MessageSquareText, StickyNote } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { i18n, useTranslation } from '@/lib/i18n'
import { describeWriteFailure } from '../channels'
import { useAddNote, useCallLine } from '../hooks'
import { newClientMessageId } from '../hooks/use-send-message'
import { MAX_MESSAGE_LENGTH, normalizeMessage } from '../model'
import type { Call } from '../types'

/** The staff-only note of a call is short (canvas: 500). */
const MAX_NOTE_LENGTH = 500

export interface CallComposerProps {
  caseId: string
  /** The active call, or null (a phone case between calls: only the note). */
  call: Call | null
  /** "Nota interna" (`capabilities.canAddNote`). */
  canNote: boolean
}

/**
 * The bottom of the call panel (slice 12): "Lo que dices" (a line of the transcript, only
 * while talking; the box says why it waits otherwise) and "Nota interna" (staff only).
 */
export function CallComposer({ caseId, call, canNote }: CallComposerProps) {
  const { t } = useTranslation('conversation')
  const line = useCallLine(caseId, call?.id ?? null)
  const note = useAddNote(caseId)
  const talking = call?.state === 'in_call'
  return (
    <div className="flex flex-col gap-2.5">
      {call ? (
        <WriteBox
          label={t('call.composer.say')}
          icon={<MessageSquareText size={13} aria-hidden="true" />}
          placeholder={talking ? t('call.composer.sayPlaceholder') : ''}
          hint={sayHint(call)}
          submitLabel={t('call.composer.sayButton')}
          submitVariant="primary"
          maxLength={MAX_MESSAGE_LENGTH}
          enabled={talking}
          mutation={line}
        />
      ) : null}
      {canNote ? (
        <WriteBox
          label={t('call.composer.note')}
          icon={<StickyNote size={13} aria-hidden="true" />}
          placeholder={t('call.composer.notePlaceholder')}
          hint={null}
          submitLabel={t('call.composer.saveNote')}
          submitVariant="secondary"
          maxLength={MAX_NOTE_LENGTH}
          enabled
          mutation={note}
        />
      ) : null}
    </div>
  )
}

function sayHint(call: Call): string | null {
  const t = i18n.getFixedT(null, 'conversation')
  switch (call.state) {
    case 'ringing':
      return call.direction === 'inbound'
        ? t('call.composer.answerHint')
        : t('call.composer.waitingHint')
    case 'on_hold':
      return t('call.composer.holdHint')
    default:
      return null
  }
}

interface WriteMutation {
  mutate(input: { text: string; clientMessageId: string }, options: { onSuccess(): void }): void
  isPending: boolean
  isError: boolean
  error: unknown
  reset(): void
}

/**
 * One-line box + button. The text stays until the server confirms it; a failure says why
 * next to the box and a new press re-sends the **same** `clientMessageId` (no duplicate).
 */
function WriteBox({
  label,
  icon,
  placeholder,
  hint,
  submitLabel,
  submitVariant,
  maxLength,
  enabled,
  mutation,
}: {
  label: string
  icon: ReactNode
  placeholder: string
  hint: string | null
  submitLabel: string
  submitVariant: 'primary' | 'secondary'
  maxLength: number
  enabled: boolean
  mutation: WriteMutation
}) {
  const id = useId()
  const [text, setText] = useState('')
  const clientMessageId = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const value = normalizeMessage(text)
  const ready = enabled && value !== null && value.length <= maxLength && !mutation.isPending

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || !value) return
    clientMessageId.current ??= newClientMessageId()
    mutation.mutate(
      { text: value, clientMessageId: clientMessageId.current },
      {
        onSuccess: () => {
          clientMessageId.current = null
          setText('')
          inputRef.current?.focus()
        },
      },
    )
  }

  const describedBy = [hint ? `${id}-hint` : null, mutation.isError ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ')
  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="inline-flex items-center gap-1.5 text-12 font-semibold text-ink-2"
      >
        {icon}
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          id={id}
          className="grow"
          autoComplete="off"
          maxLength={maxLength}
          placeholder={placeholder}
          value={text}
          disabled={!enabled}
          aria-describedby={describedBy || undefined}
          onChange={(event) => {
            setText(event.target.value)
            clientMessageId.current = null
            if (mutation.isError) mutation.reset()
          }}
        />
        <Button type="submit" variant={submitVariant} aria-disabled={!ready || undefined}>
          {submitLabel}
        </Button>
      </div>
      {hint ? (
        <span id={`${id}-hint`} className="text-12 text-muted">
          {hint}
        </span>
      ) : null}
      {mutation.isError ? (
        <span id={`${id}-error`} role="alert" className="text-12 font-medium text-danger-strong">
          {describeWriteFailure(mutation.error)}
        </span>
      ) : null}
    </form>
  )
}
