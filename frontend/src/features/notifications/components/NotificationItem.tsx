import { useId } from 'react'
import { Link } from 'react-router'
import {
  ArrowRightLeft,
  CircleArrowUp,
  Clock,
  Flame,
  Inbox,
  Lock,
  MessageSquareReply,
  RotateCcw,
  Smile,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import { buttonClasses } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import {
  NOTIFICATION_NAVIGATION,
  notificationCopy,
  notificationTime,
  type NotificationIcon,
  type NotificationTone,
} from '../model'
import type { Notification } from '../types'

const ICONS: Record<NotificationIcon, LucideIcon> = {
  inbox: Inbox,
  reply: MessageSquareReply,
  move: ArrowRightLeft,
  back: RotateCcw,
  smile: Smile,
  up: CircleArrowUp,
  clock: Clock,
  flame: Flame,
  lock: Lock,
  'user-check': UserCheck,
}

const TILE: Record<NotificationTone, string> = {
  accent: 'bg-accent-soft text-accent-strong',
  success: 'bg-success-soft text-success-strong',
  warn: 'bg-warn-soft text-warn-strong',
  danger: 'bg-danger-soft text-danger-strong',
}

/** The icon tile of a kind (36px, Callout-style tile). Decorative: the title says it. */
export function NotificationTile({
  icon,
  tone,
}: {
  icon: NotificationIcon
  tone: NotificationTone
}) {
  const Icon = ICONS[icon]
  return (
    <span
      aria-hidden="true"
      className={cn('flex size-9 shrink-0 items-center justify-center rounded-10', TILE[tone])}
    >
      <Icon size={18} />
    </span>
  )
}

export interface NotificationItemProps {
  notification: Notification
  now: number
  /** The primary action was followed (it navigates; the panel closes and marks it read). */
  onOpen(notification: Notification): void
  onMarkRead(notification: Notification): void
}

/**
 * One row of the panel (canvas Workspace "notificaciones"): the kind's tile, a short title,
 * one line, the time, the unread dot ("Sin leer"), the primary action and, while unread,
 * "Marcar como leída". The actions are described by the title, so "Abrir caso" is never
 * ambiguous for a screen reader.
 */
export function NotificationItem({ notification, now, onOpen, onMarkRead }: NotificationItemProps) {
  const { t } = useTranslation(['notifications', 'cases', 'conversation'])
  const copy = notificationCopy(notification, now)
  const unread = !notification.readAt
  const titleId = useId()
  return (
    <li
      className={cn(
        'grid grid-cols-[36px_minmax(0,1fr)_auto] gap-x-3 rounded-10 px-2 py-2.5',
        unread ? 'bg-accent-wash' : 'bg-surface',
      )}
    >
      <NotificationTile icon={copy.icon} tone={copy.tone} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          id={titleId}
          className={cn('text-14 text-ink', unread ? 'font-semibold' : 'font-medium')}
        >
          {copy.title}
        </span>
        <span className="truncate text-13 text-ink-2" title={copy.detail}>
          {copy.detail}
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <Link
            to={copy.href}
            state={NOTIFICATION_NAVIGATION}
            aria-describedby={titleId}
            onClick={() => onOpen(notification)}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            {copy.action}
          </Link>
          {unread ? (
            <button
              type="button"
              aria-describedby={titleId}
              onClick={() => onMarkRead(notification)}
              className={buttonClasses({ variant: 'ghost', size: 'sm' })}
            >
              {t('item.markRead')}
            </button>
          ) : null}
        </span>
      </span>
      <span className="flex flex-col items-end gap-2 pt-0.5">
        <time dateTime={notification.createdAt} className="text-12 whitespace-nowrap text-muted">
          {notificationTime(notification.createdAt, now)}
        </time>
        {unread ? (
          <>
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            <span className="sr-only">{t('item.unread')}</span>
          </>
        ) : null}
      </span>
    </li>
  )
}
