import { Badge, FACT_ICONS } from '@/components/ui'
import { ratingOption } from '../model'
import type { CaseRating } from '../types'

export interface RatingBadgeProps {
  rating: Pick<CaseRating, 'score'>
  /** The pill's words; default the scale word ("Bien"). */
  children?: string
  /** Read before the word by screen readers only ("Calificación del cliente"). */
  srLabel?: string
  size?: 'sm' | 'md'
  className?: string
}

/**
 * The customer's rating as a colored pill with its face and one word (slice 7; slice 8:
 * "Bien", no "El cliente calificó:"): the closed-case footer, the ficha's "Calificación"
 * row. The face is decorative: the word is always next to it.
 */
export function RatingBadge({
  rating,
  children,
  srLabel,
  size = 'md',
  className,
}: RatingBadgeProps) {
  const option = ratingOption(rating.score)
  const Icon = FACT_ICONS[option.icon]
  return (
    <Badge
      tone={option.tone}
      size={size}
      className={className}
      data-score={option.score}
      icon={<Icon size={size === 'sm' ? 13 : 14} aria-hidden="true" className="shrink-0" />}
    >
      {srLabel ? <span className="sr-only">{srLabel}: </span> : null}
      {children ?? option.label}
    </Badge>
  )
}
