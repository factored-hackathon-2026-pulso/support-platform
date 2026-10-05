import type { ButtonHTMLAttributes, Ref } from 'react'
import { cn } from '@/lib/cn'

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'role' | 'type'
> {
  checked: boolean
  onCheckedChange(checked: boolean): void
  /** The accessible name when no visible label points at it (`aria-labelledby`). */
  'aria-label'?: string
  ref?: Ref<HTMLButtonElement>
}

/**
 * An on/off switch (WAI-ARIA `role="switch"`), Linear-like: a small pill track (ink when
 * on, the border grey when off) with a white thumb. Click, Space or Enter toggle it; the
 * state is `aria-checked`. Name it with `aria-label` or `aria-labelledby`, and describe what
 * it does with `aria-describedby`.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ref,
  ...props
}: SwitchProps) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors',
        checked ? 'bg-ink' : 'bg-border',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'block size-4 rounded-full bg-surface shadow-popover transition-transform',
          checked ? 'translate-x-[17px]' : 'translate-x-[1px]',
        )}
      />
    </button>
  )
}
