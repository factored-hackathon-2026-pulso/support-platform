import type { ButtonHTMLAttributes, Ref } from 'react'
import { cn } from '@/lib/cn'
import { toneBorderLeft, type Tone } from './tones'

export interface ListItemButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Marks the current item (aria-current="true", white background, ink left border). */
  selected?: boolean
  /**
   * Permanent status color on the left border (case list). Without it the border
   * is transparent and turns ink when selected (users and teams lists).
   */
  tone?: Tone
  /** Left border width: 3 (default) or 4 (case list). */
  markWidth?: 3 | 4
  ref?: Ref<HTMLButtonElement>
}

/**
 * Full-width selectable row for master/detail lists (approvals, users, rules, cases).
 * Put the row content as children; layout (grid/flex) is up to the caller via className.
 */
export function ListItemButton({
  selected = false,
  tone,
  markWidth = 3,
  className,
  type = 'button',
  ...props
}: ListItemButtonProps) {
  return (
    <button
      type={type}
      aria-current={selected || undefined}
      className={cn(
        'w-full cursor-pointer border-0 border-b border-divider text-left text-ink transition-colors',
        markWidth === 4 ? 'border-l-4' : 'border-l-[3px]',
        tone ? toneBorderLeft[tone] : selected ? 'border-l-ink' : 'border-l-transparent',
        selected ? 'bg-surface' : 'bg-transparent hover:bg-subtle',
        className,
      )}
      {...props}
    />
  )
}
