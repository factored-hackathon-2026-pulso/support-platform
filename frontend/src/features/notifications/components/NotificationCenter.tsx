import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Bell, CircleCheck, X } from 'lucide-react'
import { Button, Callout, CountBadge, Kicker, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useNow } from '@/lib/hooks'
import {
  useMarkAllNotificationsRead,
  useNotifications,
  useNotificationToasts,
  useReadNotification,
} from '../hooks'
import { allNotifications, bellLabel, notificationSections, unreadCountOf } from '../model'
import type { Notification } from '../types'
import { NotificationItem } from './NotificationItem'

/** How often relative times ("hace 6 min") and SLA countdowns refresh while open. */
const TIME_TICK_MS = 30_000

/**
 * The bell of the dark rail (every staff role, above the avatar) and its panel, plus the
 * live toasts of the stream (`useNotificationToasts`). Canvas: Workspace "notificaciones" /
 * "notificacionesVacia", SuColas and Admin `notificaciones`, HomeTurno.
 *
 * Disclosure pattern: the bell is a button (`aria-expanded`, `aria-controls`) whose name
 * carries the count ("Notificaciones, 3 sin leer"); the panel is a labelled region anchored
 * to its right (380px, at most 560px tall, scrolls inside). Opening it moves the focus to its
 * heading; Escape, a click outside, tabbing out and the close button close it (Escape and the
 * button give the focus back to the bell).
 */
export function NotificationCenter() {
  const query = useNotifications()
  const items = useMemo(() => allNotifications(query.data), [query.data])
  const unread = unreadCountOf(query.data)
  const unreadIds = useMemo(
    () => (query.data ? new Set(items.filter((n) => !n.readAt).map((n) => n.id)) : null),
    [query.data, items],
  )
  useNotificationToasts(unreadIds)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const panelId = useId()
  const headingId = `${panelId}-heading`

  useEffect(() => {
    if (!open) return
    headingRef.current?.focus()
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      if (rootRef.current?.contains(document.activeElement)) bellRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function close({ restoreFocus }: { restoreFocus: boolean }) {
    setOpen(false)
    if (restoreFocus) bellRef.current?.focus()
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget
        if (open && next instanceof Node && !event.currentTarget.contains(next)) setOpen(false)
      }}
    >
      <button
        ref={bellRef}
        type="button"
        aria-label={bellLabel(unread)}
        aria-expanded={open}
        aria-controls={panelId}
        title="Notificaciones"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'relative flex size-11 cursor-pointer items-center justify-center rounded-10 transition-colors focus-visible:outline-white',
          open
            ? 'bg-rail-active text-white'
            : 'text-rail-icon hover:bg-rail-active/60 hover:text-white',
        )}
      >
        <Bell size={20} aria-hidden="true" />
        {unread > 0 ? <CountBadge count={unread} className="absolute top-0.5 right-0" /> : null}
      </button>
      {open ? (
        <NotificationPanel
          id={panelId}
          headingId={headingId}
          headingRef={headingRef}
          query={query}
          items={items}
          unread={unread}
          onClose={close}
        />
      ) : null}
    </div>
  )
}

interface NotificationPanelProps {
  id: string
  headingId: string
  headingRef: React.RefObject<HTMLHeadingElement | null>
  query: ReturnType<typeof useNotifications>
  items: Notification[]
  unread: number
  onClose(options: { restoreFocus: boolean }): void
}

function NotificationPanel({
  id,
  headingId,
  headingRef,
  query,
  items,
  unread,
  onClose,
}: NotificationPanelProps) {
  const now = useNow(TIME_TICK_MS)
  const read = useReadNotification()
  const markAll = useMarkAllNotificationsRead()
  const sections = notificationSections(items)

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-surface="light"
      className="absolute bottom-0 left-[62px] z-50 flex max-h-[min(560px,calc(100dvh-32px))] w-[380px] flex-col overflow-hidden rounded-14 border border-border bg-surface text-left text-14 text-ink shadow-popover"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border-soft py-2.5 pr-2.5 pl-4">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="m-0 font-display text-18 font-bold tracking-display outline-none"
        >
          Notificaciones
        </h2>
        <span className="flex items-center gap-0.5">
          {unread > 0 ? (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              className="min-h-8 cursor-pointer rounded-8 px-2 text-13 font-semibold text-accent-strong hover:bg-accent-wash focus-visible:outline-accent"
            >
              Marcar todas como leídas
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Cerrar notificaciones"
            title="Cerrar"
            onClick={() => onClose({ restoreFocus: true })}
            className="flex size-8 cursor-pointer items-center justify-center rounded-8 text-ink-2 hover:bg-panel focus-visible:outline-accent"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </span>
      </header>
      <div className="min-h-0 grow overflow-y-auto pt-1 pb-2.5">
        {query.status === 'pending' ? (
          <div className="flex justify-center py-8">
            <Spinner label="Cargando notificaciones" />
          </div>
        ) : query.status === 'error' ? (
          <div className="p-3">
            <Callout
              tone="danger"
              title="No pudimos cargar tus notificaciones"
              actions={
                <Button size="sm" onClick={() => void query.refetch()}>
                  Reintentar
                </Button>
              }
            >
              Revisa tu conexión.
            </Callout>
          </div>
        ) : (
          <>
            {unread === 0 ? <UpToDate /> : null}
            {sections.map((section) => (
              <div key={section.title} className="flex flex-col">
                <Kicker as="h3" size="sm" className="px-4 pt-2.5 pb-1.5">
                  {section.title}
                </Kicker>
                <ul className="m-0 flex list-none flex-col gap-0.5 px-2 py-0">
                  {section.items.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      now={now}
                      onOpen={(n) => {
                        read(n)
                        onClose({ restoreFocus: false })
                      }}
                      onMarkRead={read}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {query.hasNextPage ? (
              <div className="flex justify-center px-4 pt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  Cargar más
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

/** "Estás al día": nothing unread (canvas `notificacionesVacia`); read ones stay below. */
function UpToDate() {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 pt-6 pb-4 text-center">
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-12 bg-success-soft text-success-strong"
      >
        <CircleCheck size={22} />
      </span>
      <span className="text-16 font-semibold">Estás al día</span>
      <span className="text-13 text-ink-2">No tienes notificaciones nuevas.</span>
    </div>
  )
}
