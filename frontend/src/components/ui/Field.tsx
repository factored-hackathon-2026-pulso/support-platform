import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { FieldContext } from './field-context'

export interface FieldProps {
  label: ReactNode
  /** Help text under the control. */
  hint?: ReactNode
  /** Error message; marks the control aria-invalid and replaces the hint styling. */
  error?: ReactNode
  required?: boolean
  /** Element placed at the right of the label ("¿La olvidaste?"). */
  labelAside?: ReactNode
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean
  /** Provide to control the id of the inner control. */
  id?: string
  className?: string
  children: ReactNode
}

/**
 * Label + control + hint/error. The inner control receives id and ARIA wiring
 * automatically.
 *
 * @example
 * <Field label="Correo" hint="Tu cuenta corporativa"><Input type="email" /></Field>
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  labelAside,
  hideLabel = false,
  id,
  className,
  children,
}: FieldProps) {
  const autoId = useId()
  const controlId = id ?? `field-${autoId}`
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <FieldContext value={{ id: controlId, describedBy, invalid: Boolean(error), required }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <div
          className={cn(
            'flex items-baseline justify-between gap-3',
            hideLabel && !labelAside && 'sr-only',
          )}
        >
          <label
            htmlFor={controlId}
            className={cn('text-14 font-semibold text-ink', hideLabel && 'sr-only')}
          >
            {label}
            {required ? (
              <span aria-hidden="true" className="text-danger">
                {' '}
                *
              </span>
            ) : null}
          </label>
          {labelAside}
        </div>
        {children}
        {error ? (
          <span id={errorId} className="text-13 font-medium text-danger-strong">
            {error}
          </span>
        ) : null}
        {hint ? (
          <span id={hintId} className="text-12 text-muted">
            {hint}
          </span>
        ) : null}
      </div>
    </FieldContext>
  )
}
