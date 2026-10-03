import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { handleRovingKeyDown } from './roving-focus'

export interface RadioOption<V extends string = string> {
  value: V
  label: ReactNode
  /** Secondary line under the label ("En pausa · 2 abiertos · español"); describes the radio. */
  description?: ReactNode
  disabled?: boolean
}

export interface RadioGroupProps<V extends string = string> {
  /** Visible group label (also its accessible name). */
  label: ReactNode
  options: ReadonlyArray<RadioOption<V>>
  /** `null` = nothing chosen yet. */
  value: V | null
  onValueChange: (value: V) => void
  /** Marks the group required (`aria-required`) and adds the visual asterisk. */
  required?: boolean
  /** Error under the options; marks the group `aria-invalid`. */
  error?: ReactNode
  /** Form field name (defaults to a unique id). */
  name?: string
  className?: string
}

const RADIO_SELECTOR = 'input[type="radio"]'

/**
 * Single choice from a short list, shown as a vertical list of native radios
 * ("Motivo" of the close dialog). `role="radiogroup"` with a visible label;
 * arrow keys move and select (roving focus, the same in every browser), and with
 * nothing chosen yet the first radio keeps the Tab stop. Each option shows a
 * focus ring around its row.
 */
export function RadioGroup<V extends string = string>({
  label,
  options,
  value,
  onValueChange,
  required = false,
  error,
  name,
  className,
}: RadioGroupProps<V>) {
  const autoId = useId()
  const labelId = `${autoId}-label`
  const errorId = error ? `${autoId}-error` : undefined
  const groupName = name ?? autoId
  const firstEnabled = options.find((option) => !option.disabled)?.value
  const listRef = useRef<HTMLDivElement>(null)

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const list = listRef.current
    if (!list) return
    const target =
      handleRovingKeyDown(event, RADIO_SELECTOR, 'vertical', list) ??
      handleRovingKeyDown(event, RADIO_SELECTOR, 'horizontal', list)
    if (target instanceof HTMLInputElement) onValueChange(target.value as V)
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={errorId}
      aria-invalid={error ? true : undefined}
      aria-required={required || undefined}
      className={cn('flex flex-col gap-1.5', className)}
    >
      <span id={labelId} className="text-14 font-semibold text-ink">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            {' '}
            *
          </span>
        ) : null}
      </span>
      <div ref={listRef} className="flex flex-col gap-1">
        {options.map((option) => {
          const checked = option.value === value
          // Roving Tab stop: the checked radio, or the first one while none is.
          const tabbable = value === null ? option.value === firstEnabled : checked
          // With a description the name is the label alone; the description describes it.
          const optionId = `${autoId}-${option.value}`
          const describe = option.description !== undefined && option.description !== null
          return (
            <label
              key={option.value}
              className={cn(
                'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-8 border px-3 text-14 text-ink transition-colors',
                describe && 'py-2',
                'has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-accent',
                'has-disabled:cursor-not-allowed has-disabled:opacity-50',
                checked ? 'border-ink bg-surface' : 'border-border bg-surface hover:bg-subtle',
                error && !checked && 'border-danger-border',
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={option.value}
                checked={checked}
                disabled={option.disabled}
                tabIndex={tabbable ? 0 : -1}
                onChange={() => onValueChange(option.value)}
                onKeyDown={onKeyDown}
                aria-labelledby={describe ? `${optionId}-label` : undefined}
                aria-describedby={describe ? `${optionId}-description` : undefined}
                className="size-4 shrink-0 accent-ink focus-visible:outline-none"
              />
              {describe ? (
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span id={`${optionId}-label`}>{option.label}</span>
                  <span id={`${optionId}-description`} className="text-12 leading-[1.4] text-ink-2">
                    {option.description}
                  </span>
                </span>
              ) : (
                option.label
              )}
            </label>
          )
        })}
      </div>
      {error ? (
        <span id={errorId} className="text-13 font-medium text-danger-strong">
          {error}
        </span>
      ) : null}
    </div>
  )
}
