import { Button, Sheet, Stat, Status, toneBorderLeft } from '@/components/ui'
import { caseStatus, formatSla } from '@/features/cases'
import { cn } from '@/lib/cn'
import { formatRelativeTime } from '@/lib/format'
import { RECENT_RATING_HEADER, analystSheetDescription, caseRowLine } from '../model'
import { RecentRating } from './RecentRating'
import type { CaseSummary, TeamAnalyst } from '../types'
import { CaseLink } from './CaseLink'

export interface AnalystSheetProps {
  analyst: TeamAnalyst
  now: number
  onClose(): void
  onOpenCase(caseId: string): void
  onReassign(caseId: string): void
}

/**
 * One analyst (contract §8.4, `?analista=`): what she is doing now, her open
 * cases by status, and each open case with "Ver conversación" (the read-only
 * case view) and "Reasignar".
 */
export function AnalystSheet({ analyst, now, onClose, onOpenCase, onReassign }: AnalystSheetProps) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={analyst.name}
      description={analystSheetDescription(analyst)}
      width={600}
    >
      <div className="grid grid-cols-5 gap-3">
        <SheetStat label="Abiertos" value={analyst.counts.open} />
        <SheetStat label="Nuevos" value={analyst.counts.new} />
        <SheetStat label="Por responder" value={analyst.counts.toReply} />
        <SheetStat label="Esperando al cliente" value={analyst.counts.waiting} />
        <Stat
          label={RECENT_RATING_HEADER.label}
          value={<RecentRating stats={analyst.recentRatings} className="text-16" />}
          size="sm"
          className="rounded-10 border border-border bg-surface px-3 py-2.5"
        />
      </div>
      <section aria-labelledby="analyst-cases-heading" className="flex flex-col gap-2">
        <h3 id="analyst-cases-heading" className="m-0 text-15 font-semibold">
          Casos abiertos
        </h3>
        {analyst.openCases.length === 0 ? (
          <p className="m-0 text-14 text-muted">No tiene casos abiertos.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {analyst.openCases.map((summary) => (
              <OpenCaseRow
                key={summary.id}
                summary={summary}
                now={now}
                onOpenCase={onOpenCase}
                onReassign={onReassign}
              />
            ))}
          </ul>
        )}
      </section>
    </Sheet>
  )
}

function SheetStat({ label, value }: { label: string; value: number }) {
  return (
    <Stat
      label={label}
      value={value}
      size="md"
      className="rounded-10 border border-border bg-surface px-3 py-2.5"
    />
  )
}

interface OpenCaseRowProps {
  summary: CaseSummary
  now: number
  onOpenCase(caseId: string): void
  onReassign(caseId: string): void
}

function OpenCaseRow({ summary, now, onOpenCase, onReassign }: OpenCaseRowProps) {
  const status = caseStatus(summary.inboxStatus)
  const sla = formatSla(summary, now)
  return (
    <li
      className={cn(
        'flex flex-col gap-1 rounded-10 border border-l-4 border-border bg-surface py-2.5 pr-3 pl-3',
        toneBorderLeft[status.tone],
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-15 font-semibold">{summary.customer.displayName}</span>
        {sla ? (
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
        <span className="flex min-w-0 items-center gap-2.5">
          <Status {...status} size="sm" className="shrink-0" />
          <span className="truncate">{caseRowLine(summary)}</span>
        </span>
        <span className="shrink-0">{formatRelativeTime(summary.lastInteractionAt, now)}</span>
      </span>
      <span className="mt-1 flex gap-2">
        <CaseLink
          caseId={summary.id}
          onOpen={onOpenCase}
          variant="button"
          aria-label={`Ver conversación de ${summary.customer.displayName}`}
        >
          Ver conversación
        </CaseLink>
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Reasignar el caso de ${summary.customer.displayName}`}
          onClick={() => onReassign(summary.id)}
        >
          Reasignar
        </Button>
      </span>
    </li>
  )
}
