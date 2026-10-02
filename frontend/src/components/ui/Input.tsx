import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { controlBase, controlSizes, type ControlSize } from './control-styles'
import { useFieldControl } from './field-context'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** sm 34px (inline), md 40px (default), lg 48px (login). */
  size?: ControlSize
  /** Icon inside the field, on the left. */
  leadingIcon?: ReactNode
  ref?: Ref<HTMLInputElement>
}

/** Text input. Wrap it in <Field> for label / hint / error. */
export function Input({ size = 'md', leadingIcon, className, ...props }: InputProps) {
  const fieldProps = useFieldControl(props)
  if (!leadingIcon) {
    return <input className={cn(controlBase, controlSizes[size], className)} {...fieldProps} />
  }
  return (
    <div className={cn('relative flex items-center', className)}>
      <span aria-hidden="true" className="pointer-events-none absolute left-3 flex text-muted">
        {leadingIcon}
      </span>
      <input className={cn(controlBase, controlSizes[size], 'pl-9')} {...fieldProps} />
    </div>
  )
}

export interface SearchInputProps extends Omit<InputProps, 'type' | 'leadingIcon'> {
  /** Accessible name when there is no visible <Field> label. */
  'aria-label'?: string
}

/** Search field with a magnifier icon (type="search"). */
export function SearchInput({ size = 'md', ...props }: SearchInputProps) {
  return <Input type="search" size={size} leadingIcon={<Search size={16} />} {...props} />
}
