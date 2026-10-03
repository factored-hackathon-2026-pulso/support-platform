import { useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react'

export type Orientation = 'horizontal' | 'vertical'

const KEYS: Record<Orientation, { prev: string; next: string }> = {
  horizontal: { prev: 'ArrowLeft', next: 'ArrowRight' },
  vertical: { prev: 'ArrowUp', next: 'ArrowDown' },
}

/**
 * Keyboard navigation for composite widgets (tablist, listbox-like groups).
 * Moves focus between `selector` items inside `container` (default: the
 * event's currentTarget) and returns the newly focused element so callers can
 * select it.
 */
export function handleRovingKeyDown(
  event: KeyboardEvent<HTMLElement>,
  selector: string,
  orientation: Orientation = 'horizontal',
  container: HTMLElement = event.currentTarget,
): HTMLElement | null {
  const { prev, next } = KEYS[orientation]
  const isPrev = event.key === prev
  const isNext = event.key === next
  if (!isPrev && !isNext && event.key !== 'Home' && event.key !== 'End') return null

  const items = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true',
  )
  if (items.length === 0) return null

  const currentIndex = items.findIndex((el) => el === document.activeElement)
  let nextIndex = currentIndex
  if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = items.length - 1
  else if (isNext) nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
  else nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1

  const target = items[nextIndex]
  if (!target) return null
  event.preventDefault()
  target.focus()
  return target
}

/**
 * Roving tabindex fallback: when no item of a group is selected/checked, the
 * first enabled item must still be reachable with Tab. Items carry
 * `data-roving-key`; returns the key that should get tabIndex 0 (or null when a
 * selected item already has it). Re-evaluated after every render.
 */
export function useRovingFallback(
  containerRef: RefObject<HTMLElement | null>,
  itemSelector: string,
): string | null {
  const [fallback, setFallback] = useState<string | null>(null)
  // Runs after every render on purpose (items and selection come from children);
  // the functional update bails out when the fallback did not change.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector)).filter(
      (el) => !el.hasAttribute('disabled'),
    )
    const hasSelection = items.some(
      (el) =>
        el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true',
    )
    const next = hasSelection ? null : (items[0]?.dataset.rovingKey ?? null)
    setFallback((current) => (current === next ? current : next))
  })
  return fallback
}
