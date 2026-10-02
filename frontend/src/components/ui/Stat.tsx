import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { toneText, type Tone } from './tones'

export interface StatProps {
  label: ReactNode
  value: ReactNode
  /** Line under the value (trend, "en espera"…). */
  hint?: ReactNode
  /** Color of the hint. */
  hintTone?: Tone | 'muted'
  /** Color of the value (warn for "6 en riesgo de SLA"). */
  valueTone?: Tone
  /** lg: KPI tile (30px display). md: 22px display. sm: 18px semibold. */
  size?: 'sm' | 'md' | 'lg'
  /** Order: "label-first" (KPI tiles) or "value-first" (queue cards). */
  order?: 'label-first' | 'value-first'
  className?: string
}

const valueSizes = {
  sm: 'text-18 font-semibold',
  md: 'font-display text-22 font-bold',
  lg: 'font-display text-30 font-bold',
} as const

/** A number with its label (KPIs, queue counters). */
export function Stat({
  label,
  value,
  hint,
  hintTone = 'muted',
  valueTone = 'neutral',
  size = 'md',
  order = 'value-first',
  className,
}: StatProps) {
  const labelNode = (
    <span className={cn(order === 'label-first' ? 'text-13 text-ink-2' : 'text-12 text-muted')}>
      {label}
    </span>
  )
  return (
    <div className={cn('flex flex-col', order === 'label-first' && 'gap-1', className)}>
      {order === 'label-first' ? labelNode : null}
      <span className={cn('tabular', valueSizes[size], toneText[valueTone])}>{value}</span>
      {order === 'value-first' ? labelNode : null}
      {hint ? (
        <span
          className={cn(
            'text-13 font-semibold',
            hintTone === 'muted' ? 'text-muted' : toneText[hintTone],
          )}
        >
          {hint}
        </span>
      ) : null}
    </div>
  )
}
