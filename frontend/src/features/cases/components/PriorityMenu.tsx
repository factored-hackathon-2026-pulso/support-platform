import { ChoiceMenu, PriorityIcon } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import { PRIORITY_OPTIONS, casePriority, priorityMenuLabel } from '../model'
import type { CasePriority } from '../types'

export interface PriorityMenuProps {
  priority: CasePriority
  onChange(priority: CasePriority): void
  /** While a change is saving: the trigger stays, the menu cannot open again. */
  disabled?: boolean
  /** Which edge the menu lines up with (`end` in the ficha's value column). */
  align?: 'start' | 'end'
  className?: string
  triggerClassName?: string
}

/**
 * The case priority as a menu button (slice 8): the glyph and the word ("Alta") open a
 * small menu with the five levels and their glyphs, the current one checked. Used by the
 * ficha's "Prioridad" row and the supervisor's case view; the words and glyphs come from
 * the one map (`CASE_PRIORITY`).
 */
export function PriorityMenu({
  priority,
  onChange,
  disabled = false,
  align = 'start',
  className,
  triggerClassName,
}: PriorityMenuProps) {
  const { t } = useTranslation('cases')
  const current = casePriority(priority)
  const options = PRIORITY_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    icon: <PriorityIcon level={option.value} />,
  }))
  return (
    <ChoiceMenu
      value={current.value}
      options={options}
      onChange={onChange}
      triggerLabel={priorityMenuLabel(current.value)}
      menuLabel={t('priority.menu')}
      disabled={disabled}
      align={align}
      className={className}
      triggerClassName={cn('-mx-1.5 text-14', triggerClassName)}
    >
      <PriorityIcon level={current.value} />
      <span className={current.value === 'none' ? 'text-muted' : undefined}>{current.label}</span>
    </ChoiceMenu>
  )
}
