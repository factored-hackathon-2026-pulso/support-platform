import { useEffect, useRef, type RefObject } from 'react'

const CANDIDATES = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'summary',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',')

function isVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ visibilityProperty: true })
  }
  const style = getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

/**
 * Elements reachable with Tab inside `container`, in DOM order: skips
 * tabindex="-1" (inactive roving tabs), anything inside [hidden] / [inert] /
 * aria-hidden, invisible elements, and all but one radio per group (the
 * checked one, or the first when none is checked), like the browser does.
 */
export function getTabbable(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(CANDIDATES))
  const radioGroups = new Map<string, HTMLInputElement>()
  for (const node of nodes) {
    if (!(node instanceof HTMLInputElement) || node.type !== 'radio' || !node.name) continue
    const current = radioGroups.get(node.name)
    if (!current || (node.checked && !current.checked)) radioGroups.set(node.name, node)
  }
  return nodes.filter((el) => {
    if (el.tabIndex < 0) return false
    if (el.closest('[hidden],[inert],[aria-hidden="true"]')) return false
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
      if (radioGroups.get(el.name) !== el) return false
    }
    return isVisible(el)
  })
}

/** Open modals, bottom to top. Only the top one reacts to keys and clicks. */
const stack: HTMLElement[] = []

/** Background that becomes inert while a modal is open (the app root). */
function appRoot(): HTMLElement | null {
  return document.getElementById('root')
}

/** Everything below the top modal is inert: the app root and lower modal layers. */
function syncInert() {
  const root = appRoot()
  root?.toggleAttribute('inert', stack.length > 0)
  stack.forEach((panel, index) => {
    const layer = panel.closest<HTMLElement>('[data-modal-backdrop]') ?? panel
    layer.toggleAttribute('inert', index < stack.length - 1)
  })
}

function isTop(panel: HTMLElement | null): boolean {
  return panel !== null && stack[stack.length - 1] === panel
}

/** Toasts stay reachable while a modal is open (pointer and keyboard). */
function inToastRegion(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest('[data-toast-region]') !== null
}

interface UseModalOptions {
  open: boolean
  onClose: () => void
  /** Close when pressing outside the panel (on its own backdrop). */
  dismissOnOutsideClick?: boolean
  /** Element to focus first; defaults to the first tabbable inside the modal. */
  initialFocusRef?: RefObject<HTMLElement | null> | undefined
}

/**
 * Behavior shared by Dialog and Sheet: focus trap, Escape to close, click on the
 * backdrop to close, restore focus on close and lock page scroll while open.
 * Modals stack (a Dialog opened from a Sheet): only the top-most one handles
 * keys and backdrop clicks, and the layers below it plus #root are `inert`.
 */
export function useModal<T extends HTMLElement = HTMLDialogElement>({
  open,
  onClose,
  dismissOnOutsideClick = true,
  initialFocusRef,
}: UseModalOptions) {
  const containerRef = useRef<T>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    stack.push(container)
    syncInert()

    const target = initialFocusRef?.current ?? getTabbable(container)[0] ?? container
    target.focus()

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      const panel = containerRef.current
      if (!panel || !isTop(panel)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const active = document.activeElement
      // Let the browser move between toast buttons; Tab past them returns to the modal.
      if (inToastRegion(active)) return
      const items = getTabbable(panel)
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) {
        event.preventDefault()
        panel.focus()
        return
      }
      if (!panel.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    function onPointerDown(event: PointerEvent) {
      const panel = containerRef.current
      if (!dismissOnOutsideClick || !panel || !isTop(panel)) return
      if (!(event.target instanceof Element) || panel.contains(event.target)) return
      // Only a press on this modal's own backdrop closes it (not toasts or other layers).
      const ownBackdrop = panel.closest('[data-modal-backdrop]')
      if (ownBackdrop && event.target.closest('[data-modal-backdrop]') === ownBackdrop) {
        onCloseRef.current()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      const index = stack.indexOf(container)
      if (index !== -1) stack.splice(index, 1)
      syncInert()
      document.body.style.overflow = overflow
      previouslyFocused?.focus()
    }
  }, [open, initialFocusRef, dismissOnOutsideClick])

  return { containerRef }
}
