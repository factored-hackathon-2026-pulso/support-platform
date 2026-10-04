import { createContext, use, useId, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useControllableState } from './use-controllable-state'

interface AccordionContextValue {
  openValue: string | null
  toggle: (value: string) => void
}

const AccordionContext = createContext<AccordionContextValue | null>(null)

export interface AccordionProps {
  /** Open section (controlled). `null` = all closed. */
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string | null) => void
  /** Allow closing the open section by clicking it again. Default true. */
  collapsible?: boolean
  className?: string
  children: ReactNode
}

/**
 * Single-open accordion (one section open at a time).
 * Opening one section closes the others.
 */
export function Accordion({
  value,
  defaultValue = null,
  onValueChange,
  collapsible = true,
  className,
  children,
}: AccordionProps) {
  const [openValue, setOpenValue] = useControllableState<string | null>(
    value,
    defaultValue,
    onValueChange,
  )
  const toggle = (next: string) => {
    if (openValue === next) {
      if (collapsible) setOpenValue(null)
    } else {
      setOpenValue(next)
    }
  }
  return (
    <AccordionContext value={{ openValue, toggle }}>
      <div className={cn('overflow-hidden rounded-10 border border-border bg-surface', className)}>
        {children}
      </div>
    </AccordionContext>
  )
}

export interface AccordionItemProps {
  value: string
  title: ReactNode
  /** Muted number at the right of the header ("3"). */
  count?: number | string
  /** Secondary line under the title in the header. */
  summary?: ReactNode
  /** Heading level wrapping the trigger. Default h3. */
  headingLevel?: 'h2' | 'h3' | 'h4'
  className?: string
  children: ReactNode
}

export function AccordionItem({
  value,
  title,
  count,
  summary,
  headingLevel: Heading = 'h3',
  className,
  children,
}: AccordionItemProps) {
  const ctx = use(AccordionContext)
  if (!ctx) throw new Error('<AccordionItem> must be used inside <Accordion>.')
  const open = ctx.openValue === value
  const baseId = useId()
  const triggerId = `${baseId}-trigger`
  const panelId = `${baseId}-panel`

  return (
    <div className={cn('border-t border-border-soft first:border-t-0', className)}>
      <Heading className="m-0">
        <button
          type="button"
          id={triggerId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => ctx.toggle(value)}
          className="flex w-full cursor-pointer items-center justify-between gap-2 bg-surface px-3 py-[9px] text-left text-ink hover:bg-subtle"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-12 font-semibold tracking-kicker text-muted uppercase">
              {title}
            </span>
            {summary ? <span className="truncate text-13 font-normal">{summary}</span> : null}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-12 text-muted">
            {count !== undefined ? count : null}
            <ChevronDown
              aria-hidden="true"
              size={14}
              className={cn('transition-transform', open && 'rotate-180')}
            />
          </span>
        </button>
      </Heading>
      {/* Plain div, not a region: many sections would flood the landmark list (APG). */}
      <div id={panelId} hidden={!open} className="px-3 pb-2">
        {open ? children : null}
      </div>
    </div>
  )
}
