import { Tag } from 'lucide-react'
import { useAiEnabled } from '@/app/platform'
import { CaseTypeMenu, caseType } from '@/features/cases'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import { useChangeCaseType } from '../hooks'
import type { CaseDetail } from '../types'

export interface CaseTypeControlProps {
  detail: Pick<CaseDetail, 'case' | 'capabilities'>
  /** Which edge the menu lines up with (`end` in the ficha's value column). */
  align?: 'start' | 'end'
  className?: string
}

/**
 * The case type where it can change (slice 18), like `CasePriorityControl`: the menu button
 * when the viewer may change it (`capabilities.canChangeType`: the assignee or supervision,
 * open case), else the tag and the word. Nothing at all while the AI switch is off: the case
 * type is part of the AI layer.
 */
export function CaseTypeControl({ detail, align, className }: CaseTypeControlProps) {
  // The word is the shared case vocabulary: re-render when the UI language changes.
  useTranslation('cases')
  const aiEnabled = useAiEnabled()
  const { case: summary, capabilities } = detail
  const { change } = useChangeCaseType(summary.id)
  if (!aiEnabled) return null
  if (!capabilities.canChangeType) {
    const current = caseType(summary.caseType)
    return (
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        <Tag size={14} aria-hidden="true" className="shrink-0 text-muted" />
        <span className={current.value === 'none' ? 'text-muted' : undefined}>{current.label}</span>
      </span>
    )
  }
  return (
    <CaseTypeMenu
      caseType={summary.caseType}
      onChange={change}
      align={align}
      className={className}
    />
  )
}
