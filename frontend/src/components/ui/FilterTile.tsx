import {
  createContext,
  use,
  useId,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/cn'
import { toneBorderLeft, toneText, type Tone } from './tones'

/** Radio group name shared by the tiles of one FilterTileGroup. */
const FilterTileGroupContext = createContext<string | null>(null)

export interface FilterTileGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  'aria-label': string
  /** Grid columns (the case list uses 3). */
  columns?: 2 | 3 | 4
  /** Radio group name (defaults to a unique id). */
  name?: string
  children: ReactNode
}

const columnClasses = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' } as const

/**
 * Container for FilterTiles: a single-choice filter built on native radios, so
 * there is one Tab stop (the checked tile, or the first one when none is
 * checked) and the arrow keys move and select in any direction.
 */
export function FilterTileGroup({
  columns = 3,
  name,
  className,
  children,
  ...props
}: FilterTileGroupProps) {
  const autoName = useId()
  return (
    <FilterTileGroupContext value={name ?? autoName}>
      <div
        role="radiogroup"
        className={cn('grid gap-1.5', columnClasses[columns], className)}
        {...props}
      >
        {children}
      </div>
    </FilterTileGroupContext>
  )
}

export interface FilterTileProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onSelect' | 'checked' | 'name'
> {
  count: number | string
  label: string
  /** Color of the left border (and of the count, unless `neutralCount`). */
  tone?: Tone
  selected?: boolean
  onSelect?: () => void
  /** Keep the count in ink (the "Todos" tile). */
  neutralCount?: boolean
}

/**
 * Count tile with a colored left border, used as a list filter ("5 Por
 * responder"). A visually hidden radio inside a label; place it in a
 * FilterTileGroup. Tiles sit on a white surface so the tone-colored counts keep
 * 4.5:1 contrast on the grey list pane.
 */
export function FilterTile({
  count,
  label,
  tone = 'neutral',
  selected = false,
  onSelect,
  neutralCount = false,
  className,
  disabled,
  ...props
}: FilterTileProps) {
  const name = use(FilterTileGroupContext) ?? undefined
  return (
    <label
      className={cn(
        'flex min-w-0 cursor-pointer flex-col rounded-8 border border-l-[3px] bg-surface py-1.5 pr-1 pl-1.5 text-left text-ink transition-colors',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
        toneBorderLeft[tone],
        selected
          ? 'border-y-ink border-r-ink'
          : 'border-y-border border-r-border hover:border-y-muted hover:border-r-muted',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        checked={selected}
        disabled={disabled}
        onChange={() => onSelect?.()}
        className="sr-only"
        {...props}
      />
      <span
        className={cn(
          'font-display text-18 font-bold tabular',
          neutralCount || tone === 'neutral' ? 'text-ink' : toneText[tone],
        )}
      >
        {count}
      </span>{' '}
      {/* Never ellipsised (canvas: nowrap): "Por responder" must read whole in a
          320 px list, three tiles per row. */}
      <span className="text-12 tracking-tight whitespace-nowrap text-ink-2">{label}</span>
    </label>
  )
}
