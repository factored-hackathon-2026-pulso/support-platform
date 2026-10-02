import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

export type CalloutTone = 'info' | 'warn' | 'success' | 'danger' | 'neutral'

const tones: Record<CalloutTone, { box: string; title: string }> = {
  info: { box: 'border-accent-border bg-accent-wash', title: 'text-accent-strong' },
  warn: { box: 'border-warn-border bg-warn-soft', title: 'text-warn-strong' },
  success: { box: 'border-success-border bg-success-soft', title: 'text-success-strong' },
  danger: { box: 'border-danger-border bg-danger-soft', title: 'text-danger-strong' },
  neutral: { box: 'border-transparent bg-canvas', title: 'text-ink' },
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
  /** Buttons under the text. */
  actions?: ReactNode
  /** Show the tone icon (default: only for danger). Pass a node to customize. */
  icon?: boolean | ReactNode
  /** role="alert" for errors that must be announced. Default: alert for danger. */
  role?: 'alert' | 'status' | 'note'
  className?: string
}

/**
 * Tinted message box: info (blue), warn (orange), success (green), danger (red),
 * neutral (canvas grey, for explanatory notes).
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
  const showIcon = icon ?? tone === 'danger'
  const iconNode = showIcon === true ? icons[tone] : showIcon || null
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : undefined)}
      className={cn(
        'flex gap-2.5 rounded-10 border px-3 py-2.5 text-13 leading-[1.45] text-ink-2',
        style.box,
        className,
      )}
    >
      {iconNode ? <span className={cn('mt-px shrink-0', style.title)}>{iconNode}</span> : null}
      <div className="flex min-w-0 grow flex-col gap-1.5">
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
        {actions ? <div className="mt-0.5 flex flex-wrap gap-1.5">{actions}</div> : null}
      </div>
    </div>
  )
}
