import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

export type CalloutTone = 'info' | 'warn' | 'success' | 'danger' | 'neutral'

const tones: Record<CalloutTone, { box: string; title: string; tile: string }> = {
  info: {
    box: 'border-accent-border bg-accent-wash',
    title: 'text-accent-strong',
    tile: 'bg-accent-soft text-accent-strong',
  },
  warn: {
    box: 'border-warn-border bg-warn-soft',
    title: 'text-warn-strong',
    tile: 'bg-surface text-warn',
  },
  success: {
    box: 'border-success-border bg-success-soft',
    title: 'text-success-strong',
    tile: 'bg-surface text-success',
  },
  danger: {
    box: 'border-danger-border bg-danger-soft',
    title: 'text-danger-strong',
    tile: 'bg-surface text-danger',
  },
  neutral: { box: 'border-border bg-canvas', title: 'text-ink', tile: 'bg-surface text-ink-2' },
}

const icons: Record<CalloutTone, ReactNode> = {
  info: <Info size={18} aria-hidden="true" />,
  warn: <TriangleAlert size={18} aria-hidden="true" />,
  success: <CircleCheck size={18} aria-hidden="true" />,
  danger: <CircleAlert size={18} aria-hidden="true" />,
  neutral: <Info size={18} aria-hidden="true" />,
}

export interface CalloutProps {
  tone?: CalloutTone
  title?: ReactNode
  /** Render the title as an uppercase kicker ("POR QUÉ LLAMAS"). */
  kickerTitle?: boolean
  children?: ReactNode
  /** Buttons at the right of the text (they wrap under it when the box is narrow). */
  actions?: ReactNode
  /** Show the tone icon (default: shown; `false` hides it). Pass a node to customize. */
  icon?: boolean | ReactNode
  /** role="alert" for errors that must be announced. Default: alert for danger. */
  role?: 'alert' | 'status' | 'note'
  className?: string
}

/**
 * Tinted message box: info (blue), warn (orange), success (green), danger (red),
 * neutral (canvas grey, for explanatory notes). Layout: the tone icon in a small
 * tile, a short title with one line of detail, and the actions on the right,
 * vertically centred. Write a title (the fact) plus a short detail, not a paragraph.
 */
export function Callout({
  tone = 'info',
  title,
  kickerTitle = false,
  children,
  actions,
  icon,
  role,
  className,
}: CalloutProps) {
  const style = tones[tone]
  const showIcon = icon ?? true
  const iconNode = showIcon === true ? icons[tone] : showIcon || null
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : undefined)}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-12 border px-3 py-2.5 text-13 leading-[1.45] text-ink-2',
        style.box,
        className,
      )}
    >
      <div className="flex min-w-0 grow basis-56 items-center gap-3">
        {iconNode ? (
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center self-start rounded-8',
              title && children ? 'mt-0.5' : '',
              style.tile,
            )}
          >
            {iconNode}
          </span>
        ) : null}
        <div className="flex min-w-0 grow flex-col gap-0.5">
          {title ? (
            <span
              className={cn(
                'font-semibold',
                kickerTitle ? 'text-12 tracking-kicker uppercase' : 'text-14',
                style.title,
              )}
            >
              {title}
            </span>
          ) : null}
          {children ? <div className="text-ink-2">{children}</div> : null}
        </div>
      </div>
      {actions ? <div className="ml-auto flex shrink-0 flex-wrap gap-1.5">{actions}</div> : null}
    </div>
  )
}
