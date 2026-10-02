import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SourceNoteProps {
  children: ReactNode
  /** footer: pinned bar at the bottom of a panel (top border, padding). inline: plain text. */
  variant?: 'footer' | 'inline'
  className?: string
}

/**
 * Small muted line that says where the data comes from
 * ("Nombres, idiomas y canal: service_agents. Estado en vivo: datos de ejemplo.").
 * Every screen with dataset fields should have one (see ARCHITECTURE.md › Data provenance).
 */
export function SourceNote({ children, variant = 'footer', className }: SourceNoteProps) {
  return (
    <p
      className={cn(
        'm-0 text-12 text-muted',
        variant === 'footer' && 'mt-auto border-t border-border-soft px-4 py-2.5',
        className,
      )}
    >
      {children}
    </p>
  )
}
