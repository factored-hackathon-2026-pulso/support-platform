import { createContext, use } from 'react'

export interface FieldContextValue {
  id: string
  describedBy: string | undefined
  invalid: boolean
  required: boolean
}

export const FieldContext = createContext<FieldContextValue | null>(null)

/**
 * Used by Input, Textarea, Select and Checkbox to pick up id / aria-describedby /
 * aria-invalid from the surrounding Field. Explicit props always win.
 */
export function useFieldControl<
  P extends {
    id?: string
    'aria-describedby'?: string
    'aria-invalid'?: unknown
    required?: boolean
  },
>(props: P): P {
  const field = use(FieldContext)
  if (!field) return props
  return {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby': props['aria-describedby'] ?? field.describedBy,
    'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
    required: props.required ?? (field.required || undefined),
  }
}
