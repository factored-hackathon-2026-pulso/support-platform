import type { ReactNode } from 'react'
import { Spinner } from '@/components/ui'

export interface FullScreenStatusProps {
  /** Announced to screen readers and shown under the spinner. */
  label: string
  children?: ReactNode
}

/** Centered spinner over the canvas (session restore, first load). */
export function FullScreenStatus({ label, children }: FullScreenStatusProps) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-canvas text-ink-2">
      <Spinner label={label} size={24} />
      <span aria-hidden="true" className="text-14">
        {label}
      </span>
      {children}
    </div>
  )
}
