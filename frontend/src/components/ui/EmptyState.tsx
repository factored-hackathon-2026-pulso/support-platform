import type { ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'

export interface EmptyStateProps {
  /** Icon element (lucide, ~40px, stroke 1.6). */
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Buttons or links. */
  action?: ReactNode
  /** Heading level for the title. Default h2 (h1 when it is the whole page). */
  as?: 'h1' | 'h2' | 'h3'
  /** compact: for panels and lists (smaller title). */
  size?: 'default' | 'compact'
  className?: string
  /**
   * Makes the title focusable (`tabIndex=-1`) and exposes it, for screens that
   * move focus here after the content it replaces disappeared.
   */
  headingRef?: Ref<HTMLHeadingElement>
}

/** Centered message for empty lists, finished queues and placeholders. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  as: Heading = 'h2',
  size = 'default',
  className,
  headingRef,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2.5 px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="text-muted">
          {icon}
        </span>
      ) : null}
      <Heading
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className={cn(
          'm-0 font-display font-bold text-ink',
          size === 'compact' ? 'text-18' : 'text-24',
        )}
      >
        {title}
      </Heading>
      {description ? (
        <p
          className={cn('m-0 max-w-[420px] text-ink-2', size === 'compact' ? 'text-14' : 'text-15')}
        >
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1.5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}
