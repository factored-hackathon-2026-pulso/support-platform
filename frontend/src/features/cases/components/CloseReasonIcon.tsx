import { Ellipsis } from 'lucide-react'
import { cn } from '@/lib/cn'
import { closeReasonOption } from '../model'
import type { CloseReason } from '../types'
import { CLOSE_REASON_ICON, CLOSE_REASON_TILE } from './close-reason-styles'

export interface CloseReasonIconProps {
  reason: CloseReason
  /** `md` 36px (close dialog), `sm` 20px (lists, footers). */
  size?: 'sm' | 'md'
  className?: string
}

/** The reason's rounded icon tile, decorative (the label is always next to it). */
export function CloseReasonIcon({ reason, size = 'sm', className }: CloseReasonIconProps) {
  const Icon = CLOSE_REASON_ICON[reason] ?? Ellipsis
  const { tone } = closeReasonOption(reason)
  return (
    <span
      aria-hidden="true"
      data-reason={reason}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        size === 'md' ? 'size-9 rounded-10' : 'size-5 rounded-[6px]',
        CLOSE_REASON_TILE[tone],
        className,
      )}
    >
      <Icon size={size === 'md' ? 18 : 12} strokeWidth={2.2} />
    </span>
  )
}
