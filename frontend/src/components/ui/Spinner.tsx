import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SpinnerProps {
  /** Accessible label. Pass `null` when the parent already announces loading. */
  label?: string | null
  size?: number
  className?: string
}

/** Indeterminate loading indicator. */
export function Spinner({ label = 'Cargando', size = 16, className }: SpinnerProps) {
  const icon = (
    <LoaderCircle
      aria-hidden="true"
      size={size}
      className="animate-spin motion-reduce:animate-none"
    />
  )
  if (!label)
    return <span className={cn('inline-flex items-center text-current', className)}>{icon}</span>
  // <output> has the implicit "status" role: the label is announced politely.
  return (
    <output className={cn('inline-flex items-center text-current', className)}>
      {icon}
      <span className="sr-only">{label}</span>
    </output>
  )
}

export interface SkeletonProps {
  className?: string
}

/** Placeholder block shown while content loads. Size it with `className` (h-4 w-32…). */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('block animate-pulse rounded-8 bg-panel motion-reduce:animate-none', className)}
    />
  )
}
