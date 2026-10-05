import { Button, Fact, Sheet, Stat, Status, toneBorderLeft } from '@/components/ui'
import { caseStatus } from '@/features/cases'
import { cn } from '@/lib/cn'
import { formatRelativeTime } from '@/lib/format'
import { useTranslation } from '@/lib/i18n'
import {
  ACTIVITY_META,
  RECENT_RATING_HEADER,
  firstResponseFact,
  withoutKey,
  caseRowFacts,
} from '../model'
import { RecentRating } from './RecentRating'
import type { CaseSummary, TeamAnalyst } from '../types'
import { CaseLink } from './CaseLink'
import { CaseStatusCell } from './CaseCells'

export interface AnalystSheetProps {
  analyst: TeamAnalyst
  now: number
  onClose(): void
  onOpenCase(caseId: string): void
  onReassign(caseId: string): void
}

/**
 * One analyst (`?analyst=`): what she is doing now, her languages and team as facts,
 * her figures, and each open case with "Ver conversación" (the read-only case view)
 * and "Reasignar" (the exception: assignment is automatic).
 */
export function AnalystSheet({ analyst, now, onClose, onOpenCase, onReassign }: AnalystSheetProps) {
  const { t } = useTranslation(['supervision', 'cases', 'conversation', 'common'])
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={analyst.name}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Status {...ACTIVITY_META[analyst.activity]} />
          <Fact
            icon="languages"
            text=""
            languages={analyst.languages}
            label={t('common:fields.languages')}
            size="md"
          />
          <Fact icon="users" text={analyst.team.name} label={t('common:fields.team')} size="md" />
        </span>
      }
      width={600}
    >
      <div className="grid grid-cols-5 gap-3">
        <SheetStat label={t('sheet.open')} value={analyst.counts.open} />
        <SheetStat label={t('sheet.new')} value={analyst.counts.new} />
        <SheetStat label={t('sheet.toReply')} value={analyst.counts.toReply} />
        <SheetStat label={t('sheet.waiting')} value={analyst.counts.waiting} />
        <Stat
          label={RECENT_RATING_HEADER.label}
          value={<RecentRating stats={analyst.recentRatings} className="text-16" />}
          size="sm"
          className="rounded-10 border border-border bg-surface px-3 py-2.5"
        />
      </div>
      <section aria-labelledby="analyst-cases-heading" className="flex flex-col gap-2">
        <h3 id="analyst-cases-heading" className="m-0 text-15 font-semibold">
          {t('sheet.casesHeading')}
        </h3>
        {analyst.openCases.length === 0 ? (
          <p className="m-0 text-14 text-muted">{t('sheet.noCases')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {analyst.openCases.map((summary) => (
              <OpenCaseItem
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

interface OpenCaseItemProps {
  summary: CaseSummary
  now: number
  onOpenCase(caseId: string): void
  onReassign(caseId: string): void
}

function OpenCaseItem({ summary, now, onOpenCase, onReassign }: OpenCaseItemProps) {
  const { t } = useTranslation(['supervision', 'cases', 'conversation'])
  const status = caseStatus(summary.inboxStatus)
  const firstResponse = firstResponseFact(summary, now)
  return (
    <li
      className={cn(
        'flex flex-col gap-1 rounded-10 border border-l-4 border-border bg-surface py-2.5 pr-3 pl-3',
        toneBorderLeft[status.tone],
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-15 font-semibold">{summary.customer.displayName}</span>
        <Fact {...withoutKey(firstResponse)} className="shrink-0" />
      </span>
      <span className="truncate text-13 text-ink-2">
        {summary.preview ?? t('sheet.noMessages')}
      </span>
      <span className="flex items-center justify-between gap-2 text-12 text-muted">
        <span className="flex min-w-0 items-center gap-2.5">
          <CaseStatusCell summary={summary} size="sm" />
          {caseRowFacts(summary).map(({ key, ...fact }) => (
            <Fact key={key} {...fact} />
          ))}
        </span>
        <span className="shrink-0">{formatRelativeTime(summary.lastInteractionAt, now)}</span>
      </span>
      <span className="mt-1 flex gap-2">
        <CaseLink
          caseId={summary.id}
          onOpen={onOpenCase}
          variant="button"
          aria-label={t('sheet.viewConversationOf', { name: summary.customer.displayName })}
        >
          {t('sheet.viewConversation')}
        </CaseLink>
        <Button
          size="sm"
          variant="secondary"
          aria-label={t('sheet.reassignCaseOf', { name: summary.customer.displayName })}
          onClick={() => onReassign(summary.id)}
        >
          {t('actions.reassign')}
        </Button>
      </span>
    </li>
  )
}
