import { Avatar, type AvatarSize } from '@/components/ui'
import { cn } from '@/lib/cn'
import { presenceTone } from '../model'
import type { AnalystActivity } from '../types'

const DOT: Record<ReturnType<typeof presenceTone>, string> = {
  success: 'bg-success',
  warn: 'bg-warn',
  offline: 'bg-offline',
}

export interface AnalystAvatarProps {
  name: string
  /** Shows the presence dot (green connected, orange paused, grey without a session). */
  activity?: AnalystActivity
  size?: AvatarSize
  className?: string
}

/**
 * Initials of a person of the team, decorative (the name is always next to it), with an
 * optional presence dot. The state itself is said in words next to it (`Status`).
 */
export function AnalystAvatar({ name, activity, size = 'sm', className }: AnalystAvatarProps) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Avatar name={name} size={size} tone="neutral" decorative />
      {activity ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-surface',
            DOT[presenceTone(activity)],
          )}
        />
      ) : null}
    </span>
  )
}
