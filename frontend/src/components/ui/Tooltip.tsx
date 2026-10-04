import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TooltipProps {
  /** The short text shown above the trigger on hover and on keyboard focus. */
  content: ReactNode
  children: ReactNode
  /**
   * The trigger takes the keyboard focus (Tab) so the tooltip is reachable
   * without a mouse. Pass `false` inside a button or a link (interactive content
   * cannot nest): the text must then already be in the control's accessible name.
   */
  focusable?: boolean
  className?: string
}

/**
 * A small dark tooltip for icon-only facts (slice 6 UI rule: secondary,
 * easy-to-learn facts such as the channel or the priority flag may be just an
 * icon). The bubble is visual only (`aria-hidden`): the trigger carries the same
 * text for assistive technology (visually hidden text or `aria-label`), so it is
 * never announced twice. Shown on hover and on `:focus-visible`.
 */
export function Tooltip({ content, children, focusable = true, className }: TooltipProps) {
  return (
    <span
      // A tooltip trigger must be reachable by keyboard (WCAG 1.4.13, 2.1.1); it acts on nothing.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={focusable ? 0 : undefined}
      className={cn(
        'group/tooltip relative inline-flex rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden -translate-x-1/2 rounded-8 bg-ink px-2 py-1 text-11 font-medium whitespace-nowrap text-white shadow-popover group-hover/tooltip:block group-focus-visible/tooltip:block"
      >
        {content}
      </span>
    </span>
  )
}
