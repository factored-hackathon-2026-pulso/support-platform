import { Button, Card, QueryState, Skeleton, type QueryLike } from '@/components/ui'
import { formatSla } from '@/features/cases'
import { cn } from '@/lib/cn'
import {
  atRiskCount,
  queueOldestWait,
  queueRiskText,
  queuedWaitLabel,
  speakersCaption,
} from '../model'
import type { CaseSummary, LanguageQueue, QueueOverview } from '../types'
import { CaseLink } from './CaseLink'

export interface QueuesColumnProps {
  query: QueryLike<QueueOverview>
  now: number
  onAssign(caseId: string): void
  onOpenCase(caseId: string): void
}

/**
 * "Colas" (SuTeam, contract §8.4): one card per language queue (both always
 * listed), with the cases still waiting, oldest first. Risk and waits are
 * recomputed with the ticking clock.
 */
export function QueuesColumn({ query, now, onAssign, onOpenCase }: QueuesColumnProps) {
  return (
    <section aria-labelledby="queues-heading" className="flex min-h-0 flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="queues-heading" className="m-0 text-16 font-semibold">
          Colas
        </h2>
        {query.data ? (
          <span className="text-13 text-muted">{query.data.counts.total} en espera</span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto pb-1">
        <QueryState
          query={query}
          skeleton={<QueuesSkeleton />}
          errorTitle="No pudimos cargar las colas"
        >
          {(overview) =>
            overview.queues.map((queue) => (
              <QueueCard
                key={queue.language}
                queue={queue}
                now={now}
                onAssign={onAssign}
                onOpenCase={onOpenCase}
              />
            ))
          }
        </QueryState>
      </div>
    </section>
  )
}

interface QueueCardProps {
  queue: LanguageQueue
  now: number
  onAssign(caseId: string): void
  onOpenCase(caseId: string): void
}

function QueueCard({ queue, now, onAssign, onOpenCase }: QueueCardProps) {
  const atRisk = atRiskCount(queue.cases, now)
  const headingId = `queue-${queue.language}`
  return (
    <Card
      as="section"
      aria-labelledby={headingId}
      padding="none"
      className={cn('flex flex-col gap-2 px-4 py-3.5', atRisk > 0 && 'border-warn-border')}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={headingId} className="m-0 text-15 font-semibold">
          {queue.label}
        </h3>
        <span className={cn('text-12 font-semibold', atRisk > 0 ? 'text-warn' : 'text-muted')}>
          {queueRiskText(atRisk)}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-3 gap-2">
        <QueueFigure value={queue.waiting} label="en espera" large />
        <QueueFigure value={queueOldestWait(queue, now)} label="el más antiguo" warn={atRisk > 0} />
        <QueueFigure
          value={queue.availableSpeakers}
          label={speakersCaption(queue.availableSpeakers, queue.language)}
        />
      </dl>
      {queue.cases.length === 0 ? (
        <p className="m-0 text-13 text-muted">Sin casos en espera.</p>
      ) : (
        <ul
          aria-label={`Casos en la ${queue.label.toLowerCase()}`}
          className="m-0 flex list-none flex-col border-t border-border-soft p-0"
        >
          {queue.cases.map((summary) => (
            <QueuedCaseRow
              key={summary.id}
              summary={summary}
              now={now}
              onAssign={onAssign}
              onOpenCase={onOpenCase}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}

function QueueFigure({
  value,
  label,
  large = false,
  warn = false,
}: {
  value: string | number
  label: string
  large?: boolean
  warn?: boolean
}) {
  // Visual order value-then-label (canvas); the dl keeps the label as the term.
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-12 text-muted">{label}</dt>
      <dd
        className={cn(
          'm-0 tabular',
          large ? 'font-display text-22 font-bold' : 'pt-[5px] text-15 font-semibold',
          warn && 'text-warn',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

interface QueuedCaseRowProps {
  summary: CaseSummary
  now: number
  onAssign(caseId: string): void
  onOpenCase(caseId: string): void
}

function QueuedCaseRow({ summary, now, onAssign, onOpenCase }: QueuedCaseRowProps) {
  const sla = formatSla(summary, now)
  return (
    <li className="flex items-center gap-3 border-b border-border-soft py-2 last:border-b-0">
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <CaseLink
            caseId={summary.id}
            onOpen={onOpenCase}
            className="truncate text-14 font-semibold"
          >
            {summary.customer.displayName}
          </CaseLink>
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
        <span className="truncate text-13 text-ink-2">{summary.preview ?? 'Sin mensajes'}</span>
        <span className="text-12 text-muted">{queuedWaitLabel(summary, now)}</span>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAssign(summary.id)}
        aria-label={`Asignar el caso de ${summary.customer.displayName}`}
      >
        Asignar
      </Button>
    </li>
  )
}

function QueuesSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[0, 1].map((key) => (
        <Skeleton key={key} className="h-[132px] w-full rounded-12" />
      ))}
    </div>
  )
}
