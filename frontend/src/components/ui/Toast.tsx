import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ToastContext, type ToastOptions, type ToastRecord } from './toast-context'

/** Default time on screen for toasts without actions (ms). */
export const TOAST_DURATION = 6000

export interface ToastProviderProps {
  children: ReactNode
  /** Max toasts on screen; older ones are dropped. Default 3. */
  limit?: number
}

/**
 * Toast stack (bottom right, dark surface). The two live regions are always
 * mounted so screen readers announce toasts reliably: `status` (polite) and
 * `alert` (assertive). The region is reachable while a Dialog is open
 * (`data-toast-region`, see use-modal).
 */
export function ToastProvider({ children, limit = 3 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++
      setToasts((current) => [...current, { ...options, id }].slice(-limit))
      return id
    },
    [limit],
  )

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])
  const polite = toasts.filter((t) => (t.politeness ?? 'status') === 'status')
  const assertive = toasts.filter((t) => t.politeness === 'alert')

  return (
    <ToastContext value={value}>
      {children}
      {createPortal(
        <section
          aria-label="Notificaciones"
          data-toast-region
          className="pointer-events-none fixed right-6 bottom-6 z-[60] flex w-[380px] max-w-[calc(100vw-48px)] flex-col"
        >
          {/* <output> is a polite status live region. */}
          <output aria-live="polite" className="flex flex-col gap-2.5">
            {polite.map((t) => (
              <ToastItem key={t.id} toast={t} dismiss={dismiss} />
            ))}
          </output>
          <div role="alert" className="flex flex-col gap-2.5 not-empty:mt-2.5">
            {assertive.map((t) => (
              <ToastItem key={t.id} toast={t} dismiss={dismiss} />
            ))}
          </div>
        </section>,
        document.body,
      )}
    </ToastContext>
  )
}

interface ToastItemProps {
  toast: ToastRecord
  /** Stable (from the provider), so timers of other toasts never restart. */
  dismiss: (id: number) => void
}

function ToastItem({ toast, dismiss }: ToastItemProps) {
  const { id, title, description, tag, meta, actions = [] } = toast
  const duration =
    toast.duration === undefined ? (actions.length > 0 ? null : TOAST_DURATION) : toast.duration

  const rootRef = useRef<HTMLDivElement>(null)
  /** Where focus was before it entered the toast; restored when the toast leaves. */
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const remainingRef = useRef(duration ?? 0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused

  // Auto-dismiss, paused while hovered or focused (WCAG 2.2.1); resumes with the time left.
  useEffect(() => {
    if (duration === null || paused) return
    const startedAt = Date.now()
    const timer = setTimeout(() => dismiss(id), Math.max(0, remainingRef.current))
    return () => {
      clearTimeout(timer)
      remainingRef.current -= Date.now() - startedAt
    }
  }, [duration, paused, id, dismiss])

  // If the toast holding focus goes away, focus goes back instead of falling to <body>.
  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      if (root?.contains(document.activeElement) && returnFocusRef.current?.isConnected) {
        returnFocusRef.current.focus()
      }
    }
  }, [])

  function onFocus(event: FocusEvent<HTMLDivElement>) {
    setFocused(true)
    const from = event.relatedTarget
    if (from instanceof HTMLElement && !event.currentTarget.contains(from)) {
      returnFocusRef.current = from
    }
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
  }

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={onFocus}
      onBlur={onBlur}
      data-surface="dark"
      className="pointer-events-auto flex flex-col gap-2.5 rounded-14 bg-ink px-4 py-3.5 text-white shadow-toast"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2.5">
          {tag || meta ? (
            <span className="flex items-center gap-2">
              {tag ? (
                <span className="rounded-full bg-accent-soft px-[7px] py-px text-11 font-semibold text-accent-strong">
                  {tag}
                </span>
              ) : null}
              {meta ? <span className="text-12 text-on-dark-muted">{meta}</span> : null}
            </span>
          ) : null}
          <span className="text-15 font-semibold">{title}</span>
          {description ? <span className="text-13 text-on-dark-muted">{description}</span> : null}
        </div>
        {actions.length === 0 ? (
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => dismiss(id)}
            className="-mt-1 -mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-8 text-on-dark-muted hover:bg-rail-active hover:text-white focus-visible:outline-accent-muted"
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {actions.length > 0 ? (
        <div className="flex gap-2">
          {actions.map((action, index) => {
            const variant = action.variant ?? (index === 0 ? 'primary' : 'secondary')
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  action.onClick()
                  dismiss(id)
                }}
                className={cn(
                  'flex min-h-[34px] cursor-pointer items-center rounded-8 px-3 text-13 font-semibold focus-visible:outline-accent-muted',
                  variant === 'primary'
                    ? 'bg-white text-ink hover:bg-canvas'
                    : 'border border-ink-2 bg-transparent text-white hover:bg-rail-active',
                )}
              >
                {action.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
