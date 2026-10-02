import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button, Callout, ComposerFrame, Textarea } from '@/components/ui'
import { MAX_MESSAGE_LENGTH, normalizeMessage, REPLY_BLOCKED_COPY } from '../model'
import type { ReplyBlockedReason } from '../types'

export interface ComposerProps {
  /** Null when the analyst may write; otherwise why not (copy per reason). */
  blockedReason: ReplyBlockedReason | null
  onSend: (text: string) => void
}

/**
 * Chat composer (canvas): "Escribe al cliente", Enter sends, Shift+Enter adds a
 * line. Sending clears the box at once; the message shows in the transcript as
 * pending and turns sent or failed there. Focus goes back to the box after a
 * send, and "Enviar" is `aria-disabled` (never natively disabled) while there is
 * nothing to send, so pressing it never drops the keyboard focus to <body>.
 */
export function Composer({ blockedReason, onSend }: ComposerProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const message = normalizeMessage(text)
  const tooLong = text.trim().length > MAX_MESSAGE_LENGTH

  if (blockedReason) {
    return (
      <Callout tone="neutral" role="note">
        {REPLY_BLOCKED_COPY[blockedReason]}
      </Callout>
    )
  }

  function submit() {
    if (!message) return
    onSend(message)
    setText('')
    textareaRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  return (
    <ComposerFrame className="flex flex-col gap-2 px-3 py-2.5">
      <label htmlFor={id} className="sr-only">
        Escribe al cliente
      </label>
      <Textarea
        ref={textareaRef}
        id={id}
        variant="bare"
        rows={3}
        placeholder="Escribe al cliente"
        value={text}
        aria-describedby={hintId}
        aria-invalid={tooLong || undefined}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center justify-between gap-2">
        <span id={hintId} className={tooLong ? 'text-12 text-danger-strong' : 'text-12 text-muted'}>
          {tooLong
            ? 'El mensaje pasa de 4.000 caracteres.'
            : 'Enter envía · Shift + Enter agrega una línea'}
        </span>
        <Button
          variant="primary"
          iconEnd={<ArrowRight size={16} aria-hidden="true" />}
          aria-disabled={!message || undefined}
          onClick={submit}
        >
          Enviar
        </Button>
      </div>
    </ComposerFrame>
  )
}
