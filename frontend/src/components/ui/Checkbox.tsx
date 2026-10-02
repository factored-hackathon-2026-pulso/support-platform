import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/cn'
import { useFieldControl } from './field-context'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  /** Secondary line under the label. */
  description?: ReactNode
  /** card: bordered option tile (role assignment); plain: inline checkbox. */
  variant?: 'plain' | 'card'
  ref?: Ref<HTMLInputElement>
}

/**
 * Native checkbox (18px, ink accent) with its label. Inside a <Field> it takes
 * the Field's id, hint/error (aria-describedby), aria-invalid and required.
 */
export function Checkbox({
  label,
  description,
  variant = 'plain',
  className,
  disabled,
  ...rest
}: CheckboxProps) {
  const { id, 'aria-describedby': fieldDescribedBy, ...props } = useFieldControl(rest)
  const autoId = useId()
  const inputId = id ?? `checkbox-${autoId}`
  const descriptionId = description ? `${inputId}-description` : undefined
  const describedBy = [descriptionId, fieldDescribedBy].filter(Boolean).join(' ') || undefined
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'flex gap-2.5 text-14',
        description ? 'items-start' : 'items-center',
        variant === 'card' && 'rounded-10 border border-border px-3 py-2.5 has-checked:border-ink',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <input
        id={inputId}
        type="checkbox"
        disabled={disabled}
        aria-describedby={describedBy}
        className={cn('size-[18px] shrink-0 accent-ink', description && 'mt-px')}
        {...props}
      />
      <span className="flex flex-col gap-0.5">
        <span className={cn(variant === 'card' && 'font-semibold')}>{label}</span>
        {description ? (
          <span id={descriptionId} className="text-12 leading-[1.4] text-ink-2">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}
