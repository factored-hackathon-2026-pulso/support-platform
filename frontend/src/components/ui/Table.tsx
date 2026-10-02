import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  MouseEvent,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react'
import { createContext, use } from 'react'
import { cn } from '@/lib/cn'

interface TableContextValue {
  stickyHeader: boolean
  density: 'compact' | 'comfortable'
}

const TableContext = createContext<TableContextValue>({ stickyHeader: false, density: 'compact' })

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Keep THead visible while the wrapper scrolls (give the wrapper a height). */
  stickyHeader?: boolean
  /** compact: 40px rows (team list). comfortable: 48px rows. */
  density?: 'compact' | 'comfortable'
  /** Classes for the scroll wrapper. */
  wrapperClassName?: string
  /** Accessible name for the table. Prefer a visible <caption> or aria-labelledby. */
  'aria-label'?: string
}

/**
 * Data table with the canvas style: uppercase 12px headers, soft dividers, 14px rows.
 * Stays a native table (no grid role). For master/detail selection give rows
 * `onSelect` + `selected` and put a <TRowSelect> in the primary cell: it is the
 * keyboard / screen reader control (one Tab stop per row, aria-current), while
 * a click anywhere on the row also selects it.
 *
 * @example
 * <Table aria-label="Analistas" stickyHeader>
 *   <THead><TRow><TH>Nombre</TH><TH align="right">Abiertos</TH></TRow></THead>
 *   <TBody>{rows.map((r) => (
 *     <TRow key={r.id} selected={r.id === selectedId} onSelect={() => select(r.id)}>
 *       <TCell><TRowSelect>{r.name}</TRowSelect></TCell>…
 *     </TRow>
 *   ))}</TBody>
 * </Table>
 */
export function Table({
  stickyHeader = false,
  density = 'compact',
  wrapperClassName,
  className,
  ...props
}: TableProps) {
  return (
    <TableContext value={{ stickyHeader, density }}>
      <div className={cn('min-h-0 overflow-auto', wrapperClassName)}>
        <table
          className={cn('w-full border-separate border-spacing-0 text-left text-14', className)}
          {...props}
        />
      </div>
    </TableContext>
  )
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={className} {...props} />
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />
}

interface RowContextValue {
  selected: boolean
  onSelect: (() => void) | undefined
}

const RowContext = createContext<RowContextValue>({ selected: false, onSelect: undefined })

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"]'

export interface TRowProps extends Omit<HTMLAttributes<HTMLTableRowElement>, 'onSelect'> {
  /** Current row of a master/detail list (ink stripe; aria-current on its TRowSelect). */
  selected?: boolean
  /** Click anywhere on the row selects it. Keyboard users use the row's <TRowSelect>. */
  onSelect?: () => void
}

export function TRow({ selected = false, onSelect, className, onClick, ...props }: TRowProps) {
  function handleClick(event: MouseEvent<HTMLTableRowElement>) {
    onClick?.(event)
    // Clicks on the row's own controls (TRowSelect included) handle themselves.
    if (!onSelect || (event.target as Element).closest(INTERACTIVE)) return
    onSelect()
  }
  return (
    <RowContext value={{ selected, onSelect }}>
      <tr
        onClick={onSelect || onClick ? handleClick : undefined}
        className={cn(
          'group/row',
          onSelect && 'cursor-pointer hover:bg-subtle',
          selected && 'bg-surface [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-ink)]',
          className,
        )}
        {...props}
      />
    </RowContext>
  )
}

export interface TRowSelectProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  children: ReactNode
}

/**
 * Primary-cell button that selects its TRow (Enter / Space / click). Looks like
 * plain cell text; marks the current row with aria-current.
 */
export function TRowSelect({ className, children, ...props }: TRowSelectProps) {
  const { selected, onSelect } = use(RowContext)
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'cursor-pointer border-0 bg-transparent p-0 text-left',
        selected && 'font-semibold',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export interface THProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center'
}

export function TH({ align = 'left', className, scope = 'col', ...props }: THProps) {
  const { stickyHeader } = use(TableContext)
  return (
    <th
      scope={scope}
      className={cn(
        'border-y border-border-soft bg-surface px-4 py-2 text-12 font-semibold tracking-label whitespace-nowrap text-muted uppercase',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        stickyHeader && 'sticky top-0 z-[1]',
        className,
      )}
      {...props}
    />
  )
}

export interface TCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center'
  /** Muted secondary text style (13px ink-2). */
  muted?: boolean
  /** Tabular numbers. */
  numeric?: boolean
  /** Truncate long content with an ellipsis. */
  truncate?: boolean
  children?: ReactNode
}

export function TCell({
  align = 'left',
  muted,
  numeric,
  truncate,
  className,
  ...props
}: TCellProps) {
  const { density } = use(TableContext)
  return (
    <td
      className={cn(
        'border-b border-canvas px-4 align-middle',
        density === 'compact' ? 'h-10' : 'h-12 py-2',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        muted && 'text-13 text-ink-2',
        (numeric || align === 'right') && 'tabular',
        truncate && 'max-w-0 truncate',
        className,
      )}
      {...props}
    />
  )
}
