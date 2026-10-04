import { useId, useRef, type KeyboardEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button, ComposerFrame, Textarea } from '@/components/ui'
import { MAX_MESSAGE_LENGTH, normalizeMessage } from '../model'

export interface ComposerProps {
  /** The draft, owned by the pane so it survives the composer (see `UnsentDraft`). */
  value: string
  onChange: (text: string) => void
  onSend: (text: string) => void
}

/**
 * Chat composer (canvas): "Escribe al cliente", Enter sends, Shift+Enter adds a
 * line. Sending clears the box at once; the message shows in the transcript as
 * pending and turns sent or failed there. Focus goes back to the box after a
 * send, and "Enviar" is `aria-disabled` (never natively disabled) while there is
 * nothing to send, so pressing it never drops the keyboard focus to <body>.
 * Shown only when the viewer may reply (`ReadOnlyFooter` otherwise).
 */
export function Composer({ value: text, onChange: setText, onSend }: ComposerProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const message = normalizeMessage(text)
  const tooLong = text.trim().length > MAX_MESSAGE_LENGTH

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
            : 'Enter envía. Shift + Enter agrega una línea.'}
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
