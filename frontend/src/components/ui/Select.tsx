import type { Ref, SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { controlBase, controlSizes, type ControlSize } from './control-styles'
import { useFieldControl } from './field-context'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Options as data; alternatively pass <option> children. */
  options?: ReadonlyArray<SelectOption>
  /** First, empty option ("Elige una opción"). */
  placeholder?: string
  size?: ControlSize
  ref?: Ref<HTMLSelectElement>
}

/** Native select styled like the canvas (keeps native a11y and mobile pickers). */
export function Select({
  options,
  placeholder,
  size = 'md',
  className,
  children,
  ...props
}: SelectProps) {
  const fieldProps = useFieldControl(props)
  return (
    <div className={cn('relative flex items-center', className)}>
      <select
        className={cn(
          controlBase,
          controlSizes[size],
          'cursor-pointer appearance-none pr-9 font-normal',
        )}
        {...fieldProps}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        size={16}
        className="pointer-events-none absolute right-3 text-muted"
      />
    </div>
  )
}
