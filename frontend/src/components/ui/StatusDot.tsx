import { cn } from '@/lib/cn'
import { toneFill, type Tone } from './tones'

export interface StatusDotProps {
  tone?: Tone
  /** Diameter in px (8 by default, 10 for the call bar). */
  size?: 8 | 10
  /** Visible text next to the dot. */
  label?: string
  /** When there is no visible label, announce the status to screen readers. */
  srLabel?: string
  className?: string
}

/** Colored status dot, optionally followed by a label ("● Atendiendo"). */
export function StatusDot({
  tone = 'neutral',
  size = 8,
  label,
  srLabel,
  className,
}: StatusDotProps) {
  const dot = (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 rounded-full',
        size === 8 ? 'size-2' : 'size-2.5',
        toneFill[tone],
      )}
    />
  )
  if (!label) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        {dot}
        {srLabel ? <span className="sr-only">{srLabel}</span> : null}
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-13 text-ink-2', className)}>
      {dot}
      {label}
    </span>
  )
}
