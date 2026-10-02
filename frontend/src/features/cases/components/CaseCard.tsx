import { ListItemButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { caseCardLine, formatLastInteraction, formatSla, inboxStatusMeta } from '../model'
import type { CaseSummary } from '../types'

export interface CaseCardProps {
  summary: CaseSummary
  selected: boolean
  now: number
  onSelect: (caseId: string) => void
}

/**
 * One case of the list: left stripe = canvas status, name and "SLA x" on top,
 * last message, then "Prioridad · canal · tipo" and the time since the last
 * interaction.
 */
export function CaseCard({ summary, selected, now, onSelect }: CaseCardProps) {
  const meta = inboxStatusMeta(summary)
  const sla = formatSla(summary, now)
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
        <span
          className={cn('shrink-0 text-12 font-semibold', sla.atRisk ? 'text-warn' : 'text-ink-2')}
        >
          {sla.text}
        </span>
      </span>
      <span className="truncate text-13 text-ink-2">
        {summary.preview ?? 'Sin mensajes todavía'}
      </span>
      <span className="flex justify-between gap-2 text-12 text-muted">
        <span className="truncate">{caseCardLine(summary)}</span>
        <span className="shrink-0">{formatLastInteraction(summary, now)}</span>
      </span>
    </ListItemButton>
  )
}
