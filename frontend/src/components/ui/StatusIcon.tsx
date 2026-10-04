import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { StatusShape } from './status-shapes'
import { toneIcon, type Tone } from './tones'

export interface StatusIconProps {
  shape: StatusShape
  /** Glyph color (`toneIcon`). */
  tone?: Tone
  /** Width and height in px. */
  size?: 14 | 16
  className?: string
}

const STROKE = 1.5
/** Ring radius: with the stroke it fills 13.5 of the 16 px box. */
const RING_R = 6
/** Filled circles reach the ring's outer edge. */
const DISC_R = RING_R + STROKE / 2

/** Pie wedges from 12 o'clock, clockwise, radius 3.5 (inside the ring, a 1.75 px gap). */
const PIE_PATH = {
  'pie-25': 'M8 8V4.5A3.5 3.5 0 0 1 11.5 8Z',
  'pie-50': 'M8 8V4.5A3.5 3.5 0 0 1 8 11.5Z',
  'pie-75': 'M8 8V4.5A3.5 3.5 0 1 1 4.5 8Z',
} as const

function ring(extra?: ReactNode) {
  return (
    <>
      <circle cx="8" cy="8" r={RING_R} fill="none" stroke="currentColor" strokeWidth={STROKE} />
      {extra}
    </>
  )
}

/** A glyph drawn in the surface color on a filled disc. */
function disc(glyph: string) {
  return (
    <>
      <circle cx="8" cy="8" r={DISC_R} fill="currentColor" />
      <path
        d={glyph}
        fill="none"
        className="stroke-surface"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  )
}

function glyph(shape: StatusShape): ReactNode {
  switch (shape) {
    case 'dashed':
      // 8 dashes around the ring (pathLength normalizes the circumference).
      return (
        <circle
          cx="8"
          cy="8"
          r={RING_R}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          pathLength={32}
          strokeDasharray="2.6 1.4"
          strokeDashoffset={1.3}
        />
      )
    case 'ring':
      return ring()
    case 'pie-25':
    case 'pie-50':
    case 'pie-75':
      return ring(<path d={PIE_PATH[shape]} fill="currentColor" />)
    case 'check':
      return disc('M5.25 8.25 7.15 10 10.75 6.25')
    case 'cross':
      return disc('M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2')
    case 'dot':
      return <circle cx="8" cy="8" r={DISC_R} fill="currentColor" />
    case 'pause':
      return ring(
        <path
          d="M6.6 5.9v4.2M9.4 5.9v4.2"
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />,
      )
    case 'lock':
      return ring(
        <>
          <path
            d="M6.6 7.6V6.6a1.4 1.4 0 0 1 2.8 0v1"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.2}
          />
          <rect x="5.6" y="7.5" width="4.8" height="3.4" rx="0.8" fill="currentColor" />
        </>,
      )
  }
}

/**
 * One status glyph (`StatusShape`), colored by its tone. Decorative: the status
 * is always said in text next to it (`Status`) or in a visually hidden label
 * (`Status iconOnly`).
 */
export function StatusIcon({ shape, tone = 'neutral', size = 14, className }: StatusIconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      data-status-shape={shape}
      className={cn('shrink-0', toneIcon[tone], className)}
    >
      {glyph(shape)}
    </svg>
  )
}
