import { Badge, ListItemButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  RETURNED_TAG,
  caseCardLine,
  closeReasonLabel,
  formatClosedAgo,
  formatLastInteraction,
  formatSla,
  inboxStatusMeta,
} from '../model'
import type { CaseSummary } from '../types'

export interface CaseCardProps {
  summary: CaseSummary
  selected: boolean
  now: number
  onSelect: (caseId: string) => void
}

/**
 * One case of the list (contract §9.1). Open: left stripe = status, name and
 * the first-response "SLA x" on top (only while the first reply is pending),
 * the last message, then "Prioridad · App|Web" (+ "Volvió a escribir") and the
 * time since the last interaction. Closed (Cerrados): "Cerrado hace x", the
 * last message and the close reason.
 */
export function CaseCard({ summary, selected, now, onSelect }: CaseCardProps) {
  const meta = inboxStatusMeta(summary)
  const closed = summary.status === 'closed'
  const sla = closed ? null : formatSla(summary, now)
  return (
    <ListItemButton
      selected={selected}
      tone={meta.tone}
      markWidth={4}
      title={meta.subLabel}
      onClick={() => onSelect(summary.id)}
      className="flex flex-col gap-1 border-t border-b-0 border-t-border py-[11px] pr-3.5 pl-3"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-15 font-semibold">
          {summary.customer.displayName}
          <span className="sr-only">, {meta.subLabel}</span>
        </span>
        {closed ? (
          <span className="shrink-0 text-12 font-semibold text-muted">
            {formatClosedAgo(summary, now)}
          </span>
        ) : sla ? (
          <span
            className={cn(
              'shrink-0 text-12 font-semibold',
              sla.atRisk ? 'text-warn' : 'text-ink-2',
            )}
          >
            {sla.text}
          </span>
        ) : null}
      </span>
      <span className="truncate text-13 text-ink-2">
        {summary.preview ?? 'Sin mensajes todavía'}
      </span>
      <span className="flex items-center justify-between gap-2 text-12 text-muted">
        {closed ? (
          <span className="truncate">{closeReasonLabel(summary.closeReason)}</span>
        ) : (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{caseCardLine(summary)}</span>
              {summary.previousCaseId ? (
                <Badge tone="neutral" size="sm" title={RETURNED_TAG.title} className="shrink-0">
                  {RETURNED_TAG.label}
                </Badge>
              ) : null}
            </span>
            <span className="shrink-0">{formatLastInteraction(summary, now)}</span>
          </>
        )}
      </span>
    </ListItemButton>
  )
}
