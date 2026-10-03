import { use, useCallback, type RefCallback } from 'react'
import { ToastContext } from './toast-context'

/**
 * Ref for an element docked at the bottom of the screen (the chat composer):
 * while it is mounted, the toast stack sits above it instead of covering its
 * controls. Follows its size and the window size. No-op outside
 * <ToastProvider> and for an element with no layout (tests).
 */
export function useToastClearance<T extends HTMLElement>(): RefCallback<T> {
  const reserveBottom = use(ToastContext)?.reserveBottom
  return useCallback(
    (node: T | null) => {
      if (!node || !reserveBottom) return
      const key = Symbol('toast-clearance')
      const measure = () => {
        const rect = node.getBoundingClientRect()
        reserveBottom(
          key,
          rect.height > 0 ? Math.max(0, Math.round(window.innerHeight - rect.top)) : null,
        )
      }
      measure()
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
      observer?.observe(node)
      window.addEventListener('resize', measure)
      return () => {
        observer?.disconnect()
        window.removeEventListener('resize', measure)
        reserveBottom(key, null)
      }
    },
    [reserveBottom],
  )
}
