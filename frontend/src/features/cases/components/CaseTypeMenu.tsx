import { Tag } from 'lucide-react'
import { ChoiceMenu } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
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
  const { t } = useTranslation('cases')
  const current = caseType(value)
  const options = CASE_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
  return (
    <ChoiceMenu
      value={current.value}
      options={options}
      onChange={onChange}
      triggerLabel={caseTypeMenuLabel(current.value)}
      menuLabel={t('caseType.menu')}
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
