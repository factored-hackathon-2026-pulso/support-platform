import { cn } from '@/lib/cn'
import { FACT_ICONS, type FactItem, type FactTone } from './fact-icons'
import { LanguageMarks } from './LanguageMark'
import { Tooltip } from './Tooltip'

const TONE_TEXT: Record<FactTone, string> = {
  default: 'text-ink-2',
  muted: 'text-muted',
  danger: 'text-danger',
  warn: 'text-warn',
  success: 'text-success',
  accent: 'text-accent',
}

export interface FactProps extends Omit<FactItem, 'key'> {
  /** `sm` 12px (rows, cards), `md` 13px (panels). */
  size?: 'sm' | 'md'
  /**
   * The tooltip takes the keyboard focus (default). Pass `false` inside a button
   * or a link: the fact's text is then part of that control's name.
   */
  focusable?: boolean
  className?: string
}

/**
 * One short fact: icon + 1–3 words (+ language marks, + an optional tag). Metadata is
 * shown as separate facts, never as a dot-joined string or a wrapping sentence.
 */
export function Fact({
  icon,
  text,
  tone = 'default',
  label,
  tag,
  iconOnly = false,
  tooltip,
  languages,
  size = 'sm',
  focusable = true,
  className,
}: FactProps) {
  const Icon = FACT_ICONS[icon]
  if (iconOnly) {
    return (
      <Tooltip content={text} focusable={focusable} className={cn(TONE_TEXT[tone], className)}>
        <Icon size={size === 'md' ? 15 : 14} aria-hidden="true" className="shrink-0" />
        <span className="sr-only">{label ? `${label}: ${text}` : text}</span>
      </Tooltip>
    )
  }
  // Marks with no text: the flags are the glyph, no icon before them.
  const marksOnly = Boolean(languages?.length) && !text
  const fact = (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1 whitespace-nowrap',
        size === 'md' ? 'text-13' : 'text-12',
        TONE_TEXT[tone],
        className,
      )}
    >
      {marksOnly ? null : (
        <Icon size={size === 'md' ? 14 : 13} aria-hidden="true" className="shrink-0" />
      )}
      {label ? <span className="sr-only">{label}: </span> : null}
      {text ? <span className="truncate">{text}</span> : null}
      {languages?.length ? <LanguageMarks languages={languages} focusable={focusable} /> : null}
      {tag ? (
        <span className="ml-0.5 rounded-full bg-accent-soft px-1.5 text-11 font-semibold text-accent-strong">
          {tag}
        </span>
      ) : null}
    </span>
  )
  return tooltip ? (
    <Tooltip content={tooltip} focusable={focusable}>
      {fact}
    </Tooltip>
  ) : (
    fact
  )
}

export interface FactListProps {
  items: readonly FactItem[]
  size?: 'sm' | 'md'
  /** See `FactProps.focusable`. */
  focusable?: boolean
  /** Accessible name when the list stands alone. */
  'aria-label'?: string
  className?: string
}

/** Facts in a wrapping row (a list, so screen readers count and separate them). */
export function FactList({
  items,
  size = 'sm',
  focusable = true,
  className,
  ...props
}: FactListProps) {
  if (items.length === 0) return null
  return (
    <ul
      aria-label={props['aria-label']}
      className={cn(
        'm-0 flex min-w-0 list-none flex-wrap items-center gap-x-3 gap-y-1 p-0',
        className,
      )}
    >
      {items.map(({ key, ...fact }) => (
        <li key={key} className="flex min-w-0">
          <Fact {...fact} size={size} focusable={focusable} />
        </li>
      ))}
    </ul>
  )
}
