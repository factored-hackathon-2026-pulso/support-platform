import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { toneSoft, toneSolid, type Tone } from './tones'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  variant?: 'soft' | 'solid'
  /** sm: 11px (chips inside rows), md: 12px (headers, status). */
  size?: 'sm' | 'md'
  icon?: ReactNode
}

/** Pill-shaped label: "Cerrado", "Volvió a escribir", "Activo"… */
export function Badge({
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  icon,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-[7px] py-px text-11' : 'px-2.5 py-0.5 text-12',
        variant === 'soft' ? toneSoft[tone] : toneSolid[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  )
}

export interface CountBadgeProps {
  count: number
  className?: string
}

/** Small orange numeric badge (rail items, tab counts). Decorative: put the count in the aria-label of the parent. */
export function CountBadge({ count, className }: CountBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-badge px-[5px] text-11 font-bold text-ink',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
