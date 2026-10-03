import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useControllableState } from './use-controllable-state'

export interface SegmentedOption<V extends string = string> {
  value: V
  label: ReactNode
  /** Muted count after the label ("Acciones 4"). */
  count?: number
  icon?: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<V extends string = string> {
  options: ReadonlyArray<SegmentedOption<V>>
  value?: V
  defaultValue?: V
  onValueChange?: (value: V) => void
  /** Accessible name of the group (rendered as a visually hidden legend). */
  label: string
  /**
   * segmented: grey track with a white selected segment (compact selectors).
   * pills: transparent chips, the selected one is ink (status filters "Conectadas 12").
   */
  variant?: 'segmented' | 'pills'
  /** Segments share the width equally (segmented only). Default true. */
  fitted?: boolean
  /** Form field name (defaults to a unique id). */
  name?: string
  className?: string
}

/**
 * Single choice among a few options. Built on native radio inputs inside a
 * fieldset, so arrow keys, focus and screen reader semantics come for free.
 */
export function SegmentedControl<V extends string = string>({
  options,
  value,
  defaultValue,
  onValueChange,
  label,
  variant = 'segmented',
  fitted = true,
  name,
  className,
}: SegmentedControlProps<V>) {
  const autoName = useId()
  const fallback = (defaultValue ?? options[0]?.value ?? '') as V
  const [current, setCurrent] = useControllableState<V>(value, fallback, onValueChange)
  const isSegmented = variant === 'segmented'

  return (
    <fieldset
      className={cn(
        'm-0 min-w-0 border-0 p-0',
        isSegmented
          ? cn(
              'gap-1 rounded-10 bg-canvas p-[3px]',
              fitted ? 'grid auto-cols-fr grid-flow-col' : 'inline-flex',
            )
          : 'flex flex-wrap gap-1',
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const selected = option.value === current
        return (
          <label
            key={option.value}
            className={cn(
              'inline-flex cursor-pointer items-center justify-center gap-1.5 font-semibold whitespace-nowrap transition-colors select-none',
              'has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-accent',
              'has-disabled:cursor-not-allowed has-disabled:opacity-50',
              isSegmented
                ? cn(
                    'min-h-[34px] rounded-8 px-2.5 text-13 text-ink',
                    selected
                      ? 'bg-surface shadow-[0_1px_2px_rgb(26_25_22/0.08)]'
                      : 'hover:bg-panel',
                  )
                : cn(
                    'min-h-8 rounded-full px-2.5 text-13',
                    selected ? 'bg-ink text-white' : 'text-ink-2 hover:bg-panel',
                  ),
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={name ?? autoName}
              value={option.value}
              checked={selected}
              disabled={option.disabled}
              onChange={() => setCurrent(option.value)}
            />
            {option.icon}
            {option.label}
            {/* Whitespace keeps the accessible name readable ("Acciones 3"); flex ignores it visually. */}
            {option.count !== undefined ? ' ' : null}
            {option.count !== undefined ? (
              <span
                className={cn(isSegmented ? 'text-muted' : selected ? 'text-white' : 'text-ink-2')}
              >
                {option.count}
              </span>
            ) : null}
          </label>
        )
      })}
    </fieldset>
  )
}
