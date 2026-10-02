import { cn } from '@/lib/cn'
import { getInitials } from '@/lib/format'

export type AvatarTone = 'accent' | 'peach' | 'success' | 'neutral'
export type AvatarSize = 'sm' | 'md' | 'lg'

const tones: Record<AvatarTone, string> = {
  accent: 'bg-accent-soft',
  peach: 'bg-peach',
  success: 'bg-success-tint',
  neutral: 'bg-panel',
}

const sizes: Record<AvatarSize, string> = {
  sm: 'size-8 text-12',
  md: 'size-10 text-13',
  lg: 'size-11 text-15',
}

export interface AvatarProps {
  /** Full name: initials are derived from it and it becomes the accessible name. */
  name: string
  /** Override the computed initials. */
  initials?: string
  tone?: AvatarTone
  size?: AvatarSize
  /** Purely decorative (the name is already visible next to it). */
  decorative?: boolean
  className?: string
}

/** Round initials avatar ("DR"). */
export function Avatar({
  name,
  initials,
  tone = 'accent',
  size = 'md',
  decorative = false,
  className,
}: AvatarProps) {
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-ink',
        tones[tone],
        sizes[size],
        className,
      )}
    >
      {initials ?? getInitials(name)}
    </span>
  )
}
