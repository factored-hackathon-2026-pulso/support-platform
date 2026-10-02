import { cn } from '@/lib/cn'

export type CardPadding = 'none' | 'sm' | 'md' | 'lg'
export type CardTone = 'surface' | 'accent' | 'warn' | 'success' | 'danger' | 'muted'

const paddings: Record<CardPadding, string> = {
  none: '',
  sm: 'px-3 py-2.5',
  md: 'px-4 py-3.5',
  lg: 'px-5 py-[18px]',
}

const tones: Record<CardTone, string> = {
  surface: 'border-border bg-surface',
  accent: 'border-accent-border bg-accent-wash',
  warn: 'border-warn-border bg-warn-soft',
  success: 'border-success-border bg-success-soft',
  danger: 'border-danger-border bg-danger-soft',
  muted: 'border-border-soft bg-subtle',
}

export interface CardStyleProps {
  padding?: CardPadding
  tone?: CardTone
  /** 12 (lists, panels) or 14 (dashboard tiles). */
  radius?: 10 | 12 | 14
  /** Hover feedback (LinkCard sets it). */
  interactive?: boolean
}

/** Class names for anything that should look like a Card (div, Link, button). */
export function cardClasses({
  padding = 'md',
  tone = 'surface',
  radius = 12,
  interactive = false,
}: CardStyleProps = {}): string {
  return cn(
    'border',
    radius === 10 ? 'rounded-10' : radius === 14 ? 'rounded-14' : 'rounded-12',
    tones[tone],
    paddings[padding],
    interactive && 'block cursor-pointer text-ink transition-colors hover:border-ink-2',
  )
}
