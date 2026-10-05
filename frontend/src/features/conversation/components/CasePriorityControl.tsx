import { PriorityIcon } from '@/components/ui'
import { PriorityMenu, casePriority } from '@/features/cases'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import { useChangePriority } from '../hooks'
import type { CaseDetail } from '../types'

export interface CasePriorityControlProps {
  detail: Pick<CaseDetail, 'case' | 'capabilities'>
  /** Which edge the menu lines up with (`end` in the ficha's value column). */
  align?: 'start' | 'end'
  className?: string
}

/**
 * The case priority where it can change (slice 8): the menu button when the viewer may
 * change it (`capabilities.canChangePriority`: the assignee or supervision, open case), else
 * the glyph and the word. The change is optimistic (`useChangePriority`): a failure puts the
 * previous level back and says why in a toast.
 */
export function CasePriorityControl({ detail, align, className }: CasePriorityControlProps) {
  // The word is the shared case vocabulary: re-render when the UI language changes.
  useTranslation('cases')
  const { case: summary, capabilities } = detail
  const { change } = useChangePriority(summary.id)
  if (!capabilities.canChangePriority) {
    const current = casePriority(summary.priority)
    return (
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        <PriorityIcon level={current.value} />
        <span className={current.value === 'none' ? 'text-muted' : undefined}>{current.label}</span>
      </span>
    )
  }
  return (
    <PriorityMenu
      priority={summary.priority}
      onChange={change}
      align={align}
      className={className}
    />
  )
}
