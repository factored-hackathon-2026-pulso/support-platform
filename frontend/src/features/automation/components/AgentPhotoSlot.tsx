import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/lib/i18n'
import { cn } from '@/lib/cn'
import { useToast } from '@/components/ui'
import { useAgentAvatar, useSetAgentAvatar } from '../hooks/use-automation'
import type { AgentAvatarKey } from '../types'
import { AgentAvatar } from './AgentAvatar'
import { AGENT_AVATARS, avatarUrl } from './avatars'

export interface AgentPhotoSlotProps {
  /** agent-core's id of the agent: the photo is the agent's, so it can be picked before it serves. */
  agentId: string
}

/**
 * "Foto del agente": a dashed empty circle until a photo is set; a click opens a small row of
 * avatar tiles, and the chosen one shows in the circle.
 */
export function AgentPhotoSlot({ agentId }: AgentPhotoSlotProps) {
  const { t } = useTranslation('automation')
  const { toast } = useToast()
  const avatar = useAgentAvatar(agentId)
  const set = useSetAgentAvatar(agentId)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function pick(key: AgentAvatarKey) {
    setOpen(false)
    set.mutate(key, { onError: () => toast({ title: t('avatar.saveError') }) })
  }

  return (
    <div ref={rootRef} className="relative inline-flex items-center gap-3">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('avatar.pick')}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex size-14 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent',
          avatar ? '' : 'border border-dashed border-border hover:bg-subtle',
        )}
      >
        {avatar ? <AgentAvatar avatar={avatar} size={56} /> : null}
      </button>
      <span className="text-14 text-ink-2">{t('avatar.label')}</span>
      {open ? (
        <fieldset
          aria-label={t('avatar.label')}
          className="absolute top-full left-0 z-20 m-0 mt-2 flex gap-2 rounded-12 border border-border bg-surface p-2 shadow-popover"
        >
          {AGENT_AVATARS.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={t(`avatar.names.${key}`)}
              aria-pressed={avatar === key}
              onClick={() => pick(key)}
              className={cn(
                'size-11 shrink-0 overflow-hidden rounded-8 bg-panel outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-accent',
                avatar === key ? 'ring-2 ring-accent' : '',
              )}
            >
              <img
                src={avatarUrl(key)}
                alt=""
                className="size-full object-cover"
                draggable={false}
              />
            </button>
          ))}
        </fieldset>
      ) : null}
    </div>
  )
}
