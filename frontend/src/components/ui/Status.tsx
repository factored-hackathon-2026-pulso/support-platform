import { cn } from '@/lib/cn'
import { StatusIcon } from './StatusIcon'
import type { StatusShape } from './status-shapes'
import { toneStrongText, type Tone } from './tones'
import { Tooltip } from './Tooltip'

/**
 * How one state looks: its glyph, its tone and its word. Features keep one map
 * per domain in their pure `model.ts` (case status, availability, account) and
 * hand it to `Status`.
 */
export interface StatusAppearance {
  shape: StatusShape
  tone: Tone
  /** The state, 1–3 words: "Por responder", "En pausa", "Bloqueada". */
  label: string
  /** The label in the tone's strong color (states that ask for action). */
  strong?: boolean
}

export interface StatusProps extends StatusAppearance {
  /**
   * Only the glyph, with the label as its tooltip and its accessible text. For
   * dense places where the state is secondary; never in the analyst's case cards.
   */
  iconOnly?: boolean
  /** Read before the label by screen readers only ("Estado", "Cuenta"). */
  srLabel?: string
  /** `sm` 12px text (rows beside 12px facts), `md` 13px (default). */
  size?: 'sm' | 'md'
  /** Extra context on hover (a native title), e.g. "Hasta las 10:47". */
  title?: string
  /** Icon-only: the tooltip takes the keyboard focus (default). `false` inside a button or a link. */
  focusable?: boolean
  className?: string
}

/**
 * A state as Linear shows it: glyph + plain word, no pill. The glyph is
 * decorative; the word is the text (or, `iconOnly`, a visually hidden text with
 * a tooltip).
 */
export function Status({
  shape,
  tone,
  label,
  strong = false,
  iconOnly = false,
  srLabel,
  size = 'md',
  title,
  focusable = true,
  className,
}: StatusProps) {
  if (iconOnly) {
    return (
      <Tooltip content={label} focusable={focusable} className={className}>
        <StatusIcon shape={shape} tone={tone} />
        <span className="sr-only">{srLabel ? `${srLabel}: ${label}` : label}</span>
      </Tooltip>
    )
  }
  return (
    <span
      title={title}
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap',
        size === 'sm' ? 'text-12' : 'text-13',
        strong ? cn('font-medium', toneStrongText[tone]) : 'text-ink-2',
        className,
      )}
    >
      <StatusIcon shape={shape} tone={tone} />
      {srLabel ? <span className="sr-only">{srLabel}: </span> : null}
      <span className="truncate">{label}</span>
    </span>
  )
}
