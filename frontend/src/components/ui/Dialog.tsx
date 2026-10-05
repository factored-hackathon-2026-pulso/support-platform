import { useId, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './IconButton'
import { useModal } from './use-modal'
import { useTranslation } from '@/lib/i18n'

export type DialogSize = 'sm' | 'md' | 'lg'

const widths: Record<DialogSize, string> = {
  sm: 'w-[440px]',
  md: 'w-[560px]',
  lg: 'w-[720px]',
}

export interface DialogProps {
  open: boolean
  /** Called with `false` on Escape, overlay click, close button or Cancel. */
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Line under the title (client name · case id). */
  description?: ReactNode
  /** Main content (scrolls when tall). */
  children?: ReactNode
  /** Footer buttons, right aligned. */
  footer?: ReactNode
  /** Muted note at the left of the footer ("Queda en auditoría"). */
  footerNote?: ReactNode
  size?: DialogSize
  /** Close when clicking the backdrop. Default true. */
  dismissOnOverlayClick?: boolean
  /** Element to focus on open (defaults to the first focusable). */
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
}

/**
 * Modal dialog: title, description, body and footer. Traps focus, closes with
 * Escape and returns focus to the trigger. Rendered in a portal on <body>.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  footerNote,
  size = 'md',
  dismissOnOverlayClick = true,
  initialFocusRef,
  className,
}: DialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const close = () => onOpenChange(false)
  const { containerRef } = useModal({
    open,
    onClose: close,
    dismissOnOutsideClick: dismissOnOverlayClick,
    initialFocusRef,
  })

  if (!open) return null

  return createPortal(
    <div
      data-modal-backdrop
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-6"
    >
      <dialog
        ref={containerRef}
        open
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative m-0 flex max-h-[min(820px,calc(100dvh-48px))] max-w-full flex-col overflow-hidden rounded-16 border-0 bg-surface p-0 text-ink shadow-dialog outline-none',
          widths[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-soft px-6 pt-5 pb-3.5">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={titleId} className="m-0 font-display text-22 font-bold">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="m-0 text-13 text-ink-2">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton
            aria-label={t('actions.close')}
            size="sm"
            className="size-9"
            icon={<X size={16} />}
            onClick={close}
          />
        </div>
        {children ? (
          <div className="flex flex-col gap-4 overflow-y-auto px-6 py-4">{children}</div>
        ) : null}
        {footer || footerNote ? (
          <div className="flex items-center justify-between gap-3 border-t border-border-soft px-6 py-3.5">
            <span className="text-12 text-muted">{footerNote}</span>
            <div className="flex gap-2">{footer}</div>
          </div>
        ) : null}
      </dialog>
    </div>,
    document.body,
  )
}
