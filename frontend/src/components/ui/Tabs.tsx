import {
  createContext,
  use,
  useId,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/cn'
import { handleRovingKeyDown, useRovingFallback } from './roving-focus'
import { useControllableState } from './use-controllable-state'

interface TabsContextValue {
  value: string
  select: (value: string) => void
  baseId: string
  fitted: boolean
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabsContext(component: string): TabsContextValue {
  const ctx = use(TabsContext)
  if (!ctx) throw new Error(`<${component}> debe usarse dentro de <Tabs>.`)
  return ctx
}

/** Value of the tab that takes the Tab stop when no tab matches the current value. */
const TabListFallbackContext = createContext<string | null>(null)

const toDomId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-')

export interface TabsProps {
  value?: string
  /** Initially selected tab (uncontrolled). Without it no panel shows until a tab is picked. */
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Tabs share the width equally (support panel style). Default false. */
  fitted?: boolean
  className?: string
  children: ReactNode
}

/**
 * Underline tabs.
 * WAI-ARIA tabs pattern: arrow keys / Home / End move and select (automatic activation).
 *
 * @example
 * <Tabs defaultValue="mensajes">
 *   <TabList aria-label="Vistas"><Tab value="mensajes">Mensajes</Tab>…</TabList>
 *   <TabPanel value="mensajes">…</TabPanel>
 * </Tabs>
 */
export function Tabs({
  value,
  defaultValue = '',
  onValueChange,
  fitted = false,
  className,
  children,
}: TabsProps) {
  const [current, select] = useControllableState(value, defaultValue, onValueChange)
  const baseId = useId()
  return (
    <TabsContext value={{ value: current, select, baseId, fitted }}>
      <div className={className}>{children}</div>
    </TabsContext>
  )
}

export interface TabListProps extends HTMLAttributes<HTMLDivElement> {
  'aria-label': string
  /** Content after the tabs (e.g. a collapse button). */
  trailing?: ReactNode
}

export function TabList({ className, children, trailing, onKeyDown, ...props }: TabListProps) {
  const { select, fitted } = useTabsContext('TabList')
  const ref = useRef<HTMLDivElement>(null)
  const fallback = useRovingFallback(ref, '[role="tab"]')

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event)
    const target = handleRovingKeyDown(event, '[role="tab"]')
    const next = target?.dataset.value
    if (next !== undefined) select(next)
  }

  return (
    <div className={cn('flex border-b border-border', className)}>
      {/* Roving tabindex: the tabs are focusable, the tablist itself is not (WAI-ARIA APG). */}
      {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus */}
      <div
        ref={ref}
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className={cn('flex min-w-0 grow', fitted && '*:flex-1')}
        {...props}
      >
        <TabListFallbackContext value={fallback}>{children}</TabListFallbackContext>
      </div>
      {trailing}
    </div>
  )
}

export interface TabProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onClick'> {
  value: string
  disabled?: boolean
  /** Orange alert dot after the label ("con alertas"). */
  dot?: boolean
  /** Muted count after the label. */
  count?: number
}

export function Tab({ value, disabled, dot, count, className, children, ...props }: TabProps) {
  const ctx = useTabsContext('Tab')
  const fallback = use(TabListFallbackContext)
  const selected = ctx.value === value
  const id = `${ctx.baseId}-tab-${toDomId(value)}`
  return (
    <button
      type="button"
      role="tab"
      id={id}
      data-value={value}
      data-roving-key={value}
      aria-selected={selected}
      // Only the selected panel is guaranteed to be in the DOM (no dangling IDREFs).
      aria-controls={selected ? `${ctx.baseId}-panel-${toDomId(value)}` : undefined}
      tabIndex={selected || fallback === value ? 0 : -1}
      disabled={disabled}
      onClick={() => ctx.select(value)}
      className={cn(
        '-mb-px flex min-h-12 cursor-pointer items-center justify-center gap-1.5 border-b-2 px-3 text-14 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        selected ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? <span className="font-normal text-muted"> {count}</span> : null}
      {dot ? (
        <span className="size-2 rounded-full bg-warn">
          <span className="sr-only"> con alertas</span>
        </span>
      ) : null}
    </button>
  )
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  value: string
  /** Keep the panel mounted (hidden) when not selected. Default false. */
  keepMounted?: boolean
}

export function TabPanel({
  value,
  keepMounted = false,
  className,
  children,
  ...props
}: TabPanelProps) {
  const ctx = useTabsContext('TabPanel')
  const selected = ctx.value === value
  if (!selected && !keepMounted) return null
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${toDomId(value)}`}
      aria-labelledby={`${ctx.baseId}-tab-${toDomId(value)}`}
      hidden={!selected}
      tabIndex={0}
      className={cn('focus-visible:outline-offset-[-2px]', className)}
      {...props}
    >
      {children}
    </div>
  )
}
