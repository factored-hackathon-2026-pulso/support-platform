import { Ban, Check, Copy, Ellipsis, MessageSquareMore, type LucideIcon } from 'lucide-react'
import type { Tone } from '@/components/ui'
import type { CloseReason } from '../types'

/** The icon of each close reason (the copy and tone live in `CLOSE_REASONS`, model.ts). */
export const CLOSE_REASON_ICON: Record<CloseReason, LucideIcon> = {
  resolved: Check,
  customer_unresponsive: MessageSquareMore,
  duplicate: Copy,
  out_of_scope: Ban,
  other: Ellipsis,
}

/** Tile color per reason tone (written out for Tailwind). */
export const CLOSE_REASON_TILE: Record<Tone, string> = {
  success: 'bg-success-soft text-success-strong',
  closed: 'bg-panel text-muted',
  waiting: 'bg-panel text-muted',
  accent: 'bg-accent-soft text-accent-strong',
  warn: 'bg-warn-soft text-warn-strong',
  neutral: 'bg-canvas text-muted',
  danger: 'bg-danger-soft text-danger-strong',
}
