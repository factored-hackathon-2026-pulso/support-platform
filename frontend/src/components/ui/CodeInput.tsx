import {
  useImperativeHandle,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
} from 'react'
import { cn } from '@/lib/cn'
import { deleteDigit, insertDigits, sanitizeDigits } from './code-input-model'

/** Imperative handle (`ref`): move focus back into the code, e.g. after a rejected code. */
export interface CodeInputHandle {
  /** Focus box `index`, or the first empty box when omitted. */
  focus: (index?: number) => void
}

export interface CodeInputProps {
  /** Digits typed so far (0..length). */
  value: string
  onChange: (value: string) => void
  /** Number of boxes. Default 6. */
  length?: number
  /** Group label (visually hidden legend). */
  label: string
  /** Id of the hint / error text; every box points at it (aria-describedby). */
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  /** Focus the first empty box on mount (the code is the only task of the screen). */
  initialFocus?: boolean
  className?: string
  ref?: Ref<CodeInputHandle>
}

/**
 * One-time code field: one box per digit (MFA "Confirma que eres tú").
 * Typing advances, Backspace goes back, arrows move, pasting or SMS autofill
 * fills every box. Each box is labelled "Dígito n" and the group has a legend.
 */
export function CodeInput({
  value,
  onChange,
  length = 6,
  label,
  describedBy,
  invalid = false,
  disabled = false,
  initialFocus = false,
  className,
  ref,
}: CodeInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const digits = Array.from({ length }, (_, index) => value[index] ?? '')

  function focusBox(index: number) {
    const box = refs.current[Math.max(0, Math.min(index, length - 1))]
    box?.focus()
    box?.select()
  }

  useImperativeHandle(ref, () => ({ focus: (index) => focusBox(index ?? value.length) }))

  function apply(next: { value: string; focus: number }) {
    if (next.value !== value) onChange(next.value)
    // Every box is always rendered, so focus can move right away.
    focusBox(next.focus)
  }

  function handleChange(index: number, raw: string) {
    const current = digits[index]
    // Typing over a filled box (caret not selecting it) yields old + new digit: keep the new one.
    const typed = current && raw.length === 2 ? raw.replace(current, '') : raw
    const incoming = sanitizeDigits(typed, length)
    if (!incoming) return
    apply(insertDigits(value, index, incoming, length))
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault()
      apply(deleteDigit(value, index))
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusBox(index - 1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusBox(Math.min(index + 1, value.length))
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    apply(insertDigits(value, index, event.clipboardData.getData('text'), length))
  }

  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', className)}>
      <legend className="sr-only">{label}</legend>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
      >
        {digits.map((digit, index) => (
          <input
            // Boxes are positional: the index is the identity.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            ref={(element) => {
              refs.current[index] = element
            }}
            aria-label={`Dígito ${index + 1}`}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={initialFocus && index === Math.min(value.length, length - 1)}
            disabled={disabled}
            value={digit}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={(event) => handlePaste(index, event)}
            onFocus={(event) => event.target.select()}
            className={cn(
              'h-[60px] w-full min-w-0 rounded-10 border bg-surface text-center font-body text-24 font-semibold text-ink tabular transition-colors outline-none',
              'focus-visible:border-2 focus-visible:border-accent focus-visible:outline-none',
              'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted',
              invalid ? 'border-2 border-danger' : digit ? 'border-ink' : 'border-border',
            )}
          />
        ))}
      </div>
    </fieldset>
  )
}
