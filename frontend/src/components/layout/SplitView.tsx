import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SplitViewProps {
  /** List / master pane (fills the remaining width). */
  children: ReactNode
  /** Detail pane. */
  aside: ReactNode
  /** Accessible name for the detail pane (rendered as <aside>). */
  asideLabel: string
  /** Detail pane width in px (Admin uses 400–420, Workspace support panel 380). */
  asideWidth?: 320 | 380 | 400 | 420 | 440
  /** Detail on the right (default) or on the left (case list). */
  asideSide?: 'left' | 'right'
  /** Detail background: surface (white, default) or panel (#ebe8e0). */
  asideTone?: 'surface' | 'panel'
  className?: string
}

const widths = {
  320: 'w-[320px]',
  380: 'w-[380px]',
  400: 'w-[400px]',
  420: 'w-[420px]',
  440: 'w-[440px]',
} as const

/** Master/detail layout: a flexible pane plus a fixed-width aside, both full height. */
export function SplitView({
  children,
  aside,
  asideLabel,
  asideWidth = 400,
  asideSide = 'right',
  asideTone = 'surface',
  className,
}: SplitViewProps) {
  const asideNode = (
    <aside
      aria-label={asideLabel}
      className={cn(
        'flex min-h-0 shrink-0 flex-col overflow-hidden border-border',
        asideSide === 'right' ? 'border-l' : 'border-r',
        asideTone === 'surface' ? 'bg-surface' : 'bg-panel',
        widths[asideWidth],
      )}
    >
      {aside}
    </aside>
  )
  return (
    <div className={cn('flex min-h-0 grow', className)}>
      {asideSide === 'left' ? asideNode : null}
      <div className="flex min-h-0 min-w-0 grow flex-col">{children}</div>
      {asideSide === 'right' ? asideNode : null}
    </div>
  )
}
