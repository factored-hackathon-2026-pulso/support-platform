import { cn } from '@/lib/cn'
import type { PriorityLevel } from './priority-levels'

export interface PriorityIconProps {
  level: PriorityLevel
  /** Width and height in px (default 14). */
  size?: number
  className?: string
}

/** Signal bars on a 16 px grid: left to right, rising, all ending on the same baseline. */
const BARS = [
  { x: 2, y: 9, height: 5 },
  { x: 6.5, y: 5.5, height: 8.5 },
  { x: 11, y: 2, height: 12 },
] as const

const FILLED: Record<Exclude<PriorityLevel, 'critical'>, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
}

/**
 * A priority as Linear draws it: `none` = three dotted bars; `low`, `medium`, `high` =
 * one, two or three of three bars filled (the rest faint); `critical` = an exclamation
 * mark in a filled square, in the danger tone. Decorative: the level is always said in
 * text next to it or in the control's accessible name (`aria-hidden`).
 */
export function PriorityIcon({ level, size = 14, className }: PriorityIconProps) {
  if (level === 'critical') {
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        data-priority={level}
        className={cn('shrink-0 text-danger', className)}
      >
        <rect x="1" y="1" width="14" height="14" rx="3.5" fill="currentColor" />
        <path
          d="M8 4.25v4.75"
          fill="none"
          className="stroke-surface"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <circle cx="8" cy="11.75" r="1.15" className="fill-surface" />
      </svg>
    )
  }
  const filled = FILLED[level]
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      data-priority={level}
      className={cn('shrink-0', level === 'none' ? 'text-muted' : 'text-ink-2', className)}
    >
      {BARS.map((bar, index) =>
        level === 'none' ? (
          <path
            key={bar.x}
            data-bar="dotted"
            d={`M${bar.x + 1.5} ${bar.y + 0.75}V${bar.y + bar.height - 0.75}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray="0.01 2.4"
          />
        ) : (
          <rect
            key={bar.x}
            data-bar={index < filled ? 'on' : 'off'}
            x={bar.x}
            y={bar.y}
            width="3"
            height={bar.height}
            rx="1"
            fill="currentColor"
            opacity={index < filled ? 1 : 0.25}
          />
        ),
      )}
    </svg>
  )
}
