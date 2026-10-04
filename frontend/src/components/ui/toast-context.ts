import { createContext, use, type ReactNode } from 'react'

export interface ToastAction {
  label: string
  onClick: () => void
  /** primary: white button; secondary: outlined. Default: first primary, rest secondary. */
  variant?: 'primary' | 'secondary'
}

export interface ToastOptions {
  title: ReactNode
  description?: ReactNode
  /** Small blue pill before the meta line ("Nuevo"). */
  tag?: string
  /** Muted line on top ("Cola de soporte · hace 1 min"). */
  meta?: ReactNode
  actions?: ToastAction[]
  /** ms before auto-dismiss. `null` keeps it until dismissed. Default 6000 (null with actions). */
  duration?: number | null
  /** Use "alert" for errors that must interrupt (role="alert"). Default "status". */
  politeness?: 'status' | 'alert'
}

export interface ToastRecord extends ToastOptions {
  id: number
}

export interface ToastContextValue {
  toast: (options: ToastOptions) => number
  dismiss: (id: number) => void
  /**
   * Keeps the stack above a bottom-docked element (`useToastClearance`): `px`
   * from the bottom of the viewport to its top, `null` to release it.
   */
  reserveBottom: (key: symbol, px: number | null) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

/** Show and dismiss toasts from anywhere under <ToastProvider>. */
export function useToast(): ToastContextValue {
  const ctx = use(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>.')
  return ctx
}
