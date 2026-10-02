import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type KickerTone = 'muted' | 'accent' | 'warn' | 'success' | 'danger' | 'ink'

const tones: Record<KickerTone, string> = {
  muted: 'text-muted',
  accent: 'text-accent-strong',
  warn: 'text-warn-strong',
  success: 'text-success-strong',
  danger: 'text-danger-strong',
  ink: 'text-ink',
}

export interface KickerProps extends HTMLAttributes<HTMLElement> {
  tone?: KickerTone
  /** md: 12px (default, section labels). sm: 11px (popover headings). */
  size?: 'sm' | 'md'
  /** Element to render (intrinsic tags only; props are HTMLElement props). */
  as?: 'span' | 'p' | 'div' | 'h2' | 'h3' | 'h4' | 'dt' | 'legend'
}

/** Small uppercase label used across the canvas ("CÓMO LLEGÓ A TI", "POR QUÉ LLAMAS"). */
export function Kicker({
  tone = 'muted',
  size = 'md',
  as: Component = 'span',
  className,
  ...props
}: KickerProps) {
  return (
    <Component
      className={cn(
        'font-semibold tracking-kicker uppercase',
        size === 'sm' ? 'text-11' : 'text-12',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
