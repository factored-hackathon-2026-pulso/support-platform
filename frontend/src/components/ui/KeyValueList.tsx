import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface KeyValueItem {
  key: string
  label: ReactNode
  value: ReactNode
  /** Render the value in IBM Plex Mono (ids, references). */
  mono?: boolean
  /** Emphasize the value (font-semibold). */
  strong?: boolean
}

export interface KeyValueListProps {
  items: ReadonlyArray<KeyValueItem>
  /** Width of the label column in px. Default 120. */
  labelWidth?: 100 | 120 | 140 | 160
  className?: string
}

const labelWidths = {
  100: 'grid-cols-[100px_minmax(0,1fr)]',
  120: 'grid-cols-[120px_minmax(0,1fr)]',
  140: 'grid-cols-[140px_minmax(0,1fr)]',
  160: 'grid-cols-[160px_minmax(0,1fr)]',
} as const

/** Definition list in a two-column grid ("Monto · $1.585.208 COP"). */
export function KeyValueList({ items, labelWidth = 120, className }: KeyValueListProps) {
  return (
    <dl className={cn('m-0 grid gap-x-3 gap-y-2.5 text-14', labelWidths[labelWidth], className)}>
      {items.map((item) => (
        <div key={item.key} className="contents">
          <dt className="text-muted">{item.label}</dt>
          <dd
            className={cn(
              'm-0 leading-[1.4]',
              item.mono && 'font-mono text-12',
              item.strong && 'font-semibold',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
