import { Fact, Status } from '@/components/ui'
import { ESCALATED_MARKER } from '@/features/cases'
import { shortCaseId } from '@/features/conversation'
import { casePriorityFact, caseRowFacts, openCaseStatus } from '../model'
import type { CaseSummary } from '../types'
import { CaseLink } from './CaseLink'

export interface CaseCustomerCellProps {
  summary: CaseSummary
  onOpenCase(caseId: string): void
}

/**
 * The customer of a supervision row: the channel icon (icon-only, tooltip "Chat web", "Llamada entrante")
 * before the name, which links to the read-only case view, and the short case number
 * under it.
 */
export function CaseCustomerCell({ summary, onOpenCase }: CaseCustomerCellProps) {
  return (
    <span className="flex min-w-0 flex-col py-1.5">
      <span className="flex min-w-0 items-center gap-1.5">
        {caseRowFacts(summary).map(({ key, ...fact }) => (
          <Fact key={key} {...fact} tone="muted" />
        ))}
        <CaseLink caseId={summary.id} onOpen={onOpenCase} className="truncate font-semibold">
          {summary.customer.displayName}
        </CaseLink>
      </span>
      <span className="font-mono text-12 text-muted" title={summary.id}>
        {shortCaseId(summary.id)}
      </span>
    </span>
  )
}

export interface CaseStatusCellProps {
  summary: CaseSummary
  /** The priority glyph (icon-only, every level). Default true. */
  withPriority?: boolean
  size?: 'sm' | 'md'
}

/**
 * Status (glyph + word, "Sin asignar" while nobody holds it), the "Escalado" marker
 * while an escalation is open, and the priority glyph with its tooltip.
 */
export function CaseStatusCell({ summary, withPriority = true, size = 'md' }: CaseStatusCellProps) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
      <Status {...openCaseStatus(summary)} size={size} />
      {summary.escalated ? <Status {...ESCALATED_MARKER} size={size} /> : null}
      {withPriority ? <Fact {...casePriorityFact(summary)} /> : null}
    </span>
  )
}
