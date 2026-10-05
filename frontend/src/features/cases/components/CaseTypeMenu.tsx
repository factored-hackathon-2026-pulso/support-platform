import { Tag } from 'lucide-react'
import { ChoiceMenu } from '@/components/ui'
import { cn } from '@/lib/cn'
import { CASE_TYPE_OPTIONS, caseType, caseTypeMenuLabel } from '../model'
import type { CaseType } from '../types'

export interface CaseTypeMenuProps {
  caseType: CaseType
  onChange(caseType: CaseType): void
  /** While a change is saving: the trigger stays, the menu cannot open again. */
  disabled?: boolean
  /** Which edge the menu lines up with (`end` in the ficha's value column). */
  align?: 'start' | 'end'
  className?: string
  triggerClassName?: string
}

const OPTIONS = CASE_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))

/**
 * The case type as a menu button (slice 18), like `PriorityMenu`: the tag and the word
 * ("Cobro indebido") open a small menu with every type, the current one checked. Used by the
 * ficha's "Tipo de caso" row and the supervisor's case view, only while the AI switch is on.
 */
export function CaseTypeMenu({
  caseType: value,
  onChange,
  disabled = false,
  align = 'start',
  className,
  triggerClassName,
}: CaseTypeMenuProps) {
  const current = caseType(value)
  return (
    <ChoiceMenu
      value={current.value}
      options={OPTIONS}
      onChange={onChange}
      triggerLabel={caseTypeMenuLabel(current.value)}
      menuLabel="Tipo de caso"
      disabled={disabled}
      align={align}
      className={className}
      triggerClassName={cn('-mx-1.5 text-14', triggerClassName)}
    >
      <Tag size={14} aria-hidden="true" className="shrink-0 text-muted" />
      <span className={current.value === 'none' ? 'text-muted' : undefined}>{current.label}</span>
    </ChoiceMenu>
  )
}
