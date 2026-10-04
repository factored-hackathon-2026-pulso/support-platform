import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { PanelRightClose } from 'lucide-react'
import { IconButton } from '@/components/ui'

export interface SidePanelProps {
  /** Id of the panel (the trigger's `aria-controls`). */
  id: string
  title: string
  /** Close button label, e.g. "Cerrar la ficha". */
  closeLabel: string
  onClose(): void
  /**
   * Move the focus to the panel heading when it mounts (it was opened by the
   * person). A panel restored from the URL on load leaves the focus alone.
   */
  focusOnOpen?: boolean
  /** Id of the element that gets the focus back after a close (the trigger). */
  returnFocusTo?: string
  /** The sections (`SidePanelSection`). */
  children: ReactNode
}

/**
 * Right-side panel slot of a two-column screen (slice 6 §5, the Workspace's
 * "Ficha del cliente"): one 360px column next to the main content, not modal
 * (the conversation keeps working), made of titled sections so later features
 * add a section instead of another panel. Close with its button or Escape
 * (inside the panel); the focus then returns to `returnFocusTo`.
 */
export function SidePanel({
  id,
  title,
  closeLabel,
  onClose,
  focusOnOpen = false,
  returnFocusTo,
  children,
}: SidePanelProps) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (focusOnOpen) headingRef.current?.focus()
  }, [focusOnOpen])

  const close = useCallback(() => {
    onClose()
    if (!returnFocusTo) return
    // After the panel unmounts, the trigger (still on screen) takes the focus back.
    requestAnimationFrame(() => document.getElementById(returnFocusTo)?.focus())
  }, [onClose, returnFocusTo])

  // Escape closes the panel while the focus is inside it (not from the conversation).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!(event.target instanceof Node) || !panelRef.current?.contains(event.target)) return
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close])

  return (
    <aside
      ref={panelRef}
      id={id}
      aria-labelledby={headingId}
      className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-surface"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <h2
          ref={headingRef}
          id={headingId}
          tabIndex={-1}
          className="m-0 text-17 font-semibold focus-visible:outline-offset-4"
        >
          {title}
        </h2>
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={closeLabel}
          icon={<PanelRightClose size={16} aria-hidden="true" />}
          onClick={close}
        />
      </div>
      <div className="flex min-h-0 grow scrollbar-thin flex-col gap-6 overflow-y-auto px-5 py-4">
        {children}
      </div>
    </aside>
  )
}

export interface SidePanelSectionProps {
  title: string
  children: ReactNode
}

/** One titled section of a `SidePanel` (h3 under the panel's h2). */
export function SidePanelSection({ title, children }: SidePanelSectionProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3
        id={headingId}
        className="m-0 text-12 font-semibold tracking-[0.06em] text-muted uppercase"
      >
        {title}
      </h3>
      {children}
    </section>
  )
}
