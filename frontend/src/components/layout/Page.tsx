import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface PageProps {
  /** Usually a <PageHeader>. */
  header?: ReactNode
  /** Optional bar under the header (next step, filters). */
  toolbar?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Standard page frame inside the AppShell: fixed header, optional toolbar and a
 * body that fills the remaining height. Pages own their scroll areas.
 */
export function Page({ header, toolbar, children, className }: PageProps) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {header}
      {toolbar}
      {children}
    </div>
  )
}

export interface PageBodyProps extends HTMLAttributes<HTMLElement> {
  /** Scroll the body (default true). Disable when panes scroll on their own. */
  scroll?: boolean
  /** Inner padding (default true: 18px 28px like the canvas). */
  padded?: boolean
}

/** Main region of a page (<main>). */
export function PageBody({ scroll = true, padded = true, className, ...props }: PageBodyProps) {
  return (
    <main
      className={cn(
        'min-h-0 grow',
        scroll ? 'overflow-y-auto' : 'overflow-hidden',
        padded && 'px-7 py-[18px]',
        className,
      )}
      {...props}
    />
  )
}

export interface PageToolbarProps {
  children: ReactNode
  className?: string
}

/** White bar under the header ("Siguiente paso · mover 2 casos…"). */
export function PageToolbar({ children, className }: PageToolbarProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-7 py-3.5',
        className,
      )}
    >
      {children}
    </div>
  )
}
