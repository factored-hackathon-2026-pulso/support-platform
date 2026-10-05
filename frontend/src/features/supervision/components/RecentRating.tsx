import { FACT_ICONS, Tooltip, type FactTone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useActiveLocale } from '@/lib/i18n'
import { RECENT_RATING_HEADER, recentRatingCell } from '../model'
import type { RatingStats } from '../types'

const TONE_TEXT: Record<FactTone, string> = {
  default: 'text-ink-2',
  muted: 'text-muted',
  danger: 'text-danger',
  warn: 'text-warn',
  success: 'text-success',
  accent: 'text-accent',
}

export interface RecentRatingProps {
  stats: RatingStats
  className?: string
}

/**
 * "Calificación 7 días" (slice 7): the face of the average, the average ("3,6") and how
 * many cases were rated ("(9)", muted), with the tooltip "Promedio 3,6 de 4 en 9 casos
 * calificados" (also the accessible text). "—" when none was rated.
 */
export function RecentRating({ stats, className }: RecentRatingProps) {
  useActiveLocale() // the cell's copy follows a language switch
  const cell = recentRatingCell(stats)
  if (!cell) {
    return (
      <span className={cn('text-muted', className)}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{RECENT_RATING_HEADER.empty}</span>
      </span>
    )
  }
  const Icon = FACT_ICONS[cell.icon]
  return (
    <Tooltip content={cell.tooltip} className={className}>
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex items-center gap-1.5 font-semibold tabular-nums',
          TONE_TEXT[cell.tone],
        )}
      >
        <Icon size={16} className="shrink-0" />
        {cell.average}
        <span className="font-normal text-muted">{cell.count}</span>
      </span>
      <span className="sr-only">{cell.tooltip}</span>
    </Tooltip>
  )
}
