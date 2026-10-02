import { useId, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './IconButton'
import { useModal } from './use-modal'

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Accessible title. Rendered as the sheet heading unless `header` is provided. */
  title: ReactNode
  /** Custom content for the top bar (e.g. a Kicker). The title is then visually hidden. */
  header?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** Panel width in px (Home insight drawer: 600). */
  width?: 480 | 600 | 720
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
}

const widths = { 480: 'w-[480px]', 600: 'w-[600px]', 720: 'w-[720px]' } as const

/** Right-side drawer (the Panorama "detalle del tema"). Same a11y behavior as Dialog. */
export function Sheet({
  open,
  onOpenChange,
  title,
  header,
  children,
  footer,
  width = 600,
  initialFocusRef,
  className,
}: SheetProps) {
  const titleId = useId()
  const close = () => onOpenChange(false)
  const { containerRef } = useModal({ open, onClose: close, initialFocusRef })

  if (!open) return null

  return createPortal(
    <div data-modal-backdrop className="fixed inset-0 z-50 flex justify-end bg-ink/28">
      <dialog
        ref={containerRef}
        open
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative m-0 ml-auto flex h-full max-h-none max-w-full flex-col border-0 bg-canvas p-0 text-ink shadow-drawer outline-none',
          widths[width],
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-[18px]">
          {header ? (
            <>
              <div className="min-w-0">{header}</div>
              <h2 id={titleId} className="sr-only">
                {title}
              </h2>
            </>
          ) : (
            <h2 id={titleId} className="m-0 font-display text-22 font-bold">
              {title}
            </h2>
          )}
          <IconButton aria-label="Cerrar" icon={<X size={16} />} onClick={close} />
        </div>
        <div className="flex min-h-0 grow flex-col gap-5 overflow-y-auto p-6">{children}</div>
        {footer ? (
          <div className="flex gap-2.5 border-t border-border px-6 py-[18px]">{footer}</div>
        ) : null}
      </dialog>
    </div>,
    document.body,
  )
}
