import { Bot } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { AgentAvatarKey } from '../types'
import { avatarUrl } from './avatars'

export interface AgentAvatarProps {
  avatar: AgentAvatarKey | null | undefined
  /** Pixel size of the circle. */
  size?: number
  className?: string
}

/** An agent's photo in a circle; without one, the generic bot mark. Decorative: the name is next to it. */
export function AgentAvatar({ avatar, size = 28, className }: AgentAvatarProps) {
  const url = avatar ? avatarUrl(avatar) : undefined
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        url ? 'bg-panel' : 'text-accent-strong',
        className,
      )}
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" draggable={false} />
      ) : (
        <Bot size={Math.round(size * 0.55)} />
      )}
    </span>
  )
}
