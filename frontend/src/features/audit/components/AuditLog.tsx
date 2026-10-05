import { Fragment } from 'react'
import { ScrollText } from 'lucide-react'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Skeleton,
  TBody,
  TCell,
  TH,
  THead,
  TRow,
  TRowSelect,
  Table,
} from '@/components/ui'
import { shortCaseId } from '@/features/conversation'
import { useTranslation } from '@/lib/i18n'
import {
  actorName,
  actorRoleLabel,
  showsActorName,
  actorTone,
  emptyLogCopy,
  eventTime,
  groupByDay,
  shownCountLabel,
} from '../model'
import type { AuditEvent } from '../types'

export interface AuditLogProps {
  status: 'pending' | 'error' | 'success'
  events: readonly AuditEvent[]
  /** Filters are set (the empty state offers "Limpiar filtros"). */
  filtered: boolean
  /** The dates are invalid: no request was sent. */
  blocked: boolean
  selectedEventId: string | null
  now: number
  hasMore: boolean
  loadingMore: boolean
  loadMoreFailed: boolean
  retrying: boolean
  onSelect(eventId: string): void
  onLoadMore(): void
  onRetry(): void
  onClearFilters(): void
}

/**
 * "Registro" (SuAudit, contract §8.8): one row per event, newest first, under
 * day separators; "Cargar más" while the server has older pages.
 */
export function AuditLog({
  status,
  events,
  filtered,
  blocked,
  selectedEventId,
  now,
  hasMore,
  loadingMore,
  loadMoreFailed,
  retrying,
  onSelect,
  onLoadMore,
  onRetry,
  onClearFilters,
}: AuditLogProps) {
  const { t } = useTranslation(['audit', 'common'])
  let body
  if (blocked) {
    body = <p className="m-0 px-7 py-10 text-center text-14 text-muted">{t('log.blocked')}</p>
  } else if (status === 'pending') {
    body = <LogSkeleton />
  } else if (status === 'error') {
    body = (
      <div className="px-7 py-6">
        <Callout
          tone="danger"
          title={t('log.errorTitle')}
          actions={
            <Button size="sm" loading={retrying} onClick={onRetry}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {t('common:query.errorDescription')}
        </Callout>
      </div>
    )
  } else if (events.length === 0) {
    body = (
      <EmptyState
        size="compact"
        icon={<ScrollText size={36} strokeWidth={1.6} />}
        title={emptyLogCopy(filtered)}
        action={
          filtered ? (
            <Button variant="secondary" onClick={onClearFilters}>
              {t('common:filters.clear')}
            </Button>
          ) : null
        }
      />
    )
  } else {
    body = (
      <>
        <Table aria-label={t('log.table')} stickyHeader wrapperClassName="overflow-visible">
          <THead>
            <TRow>
              <TH className="w-[96px] bg-canvas pl-7">{t('log.columns.time')}</TH>
              <TH className="w-[260px] bg-canvas">{t('log.columns.who')}</TH>
              <TH className="bg-canvas">{t('log.columns.what')}</TH>
              <TH className="w-[140px] bg-canvas pr-7">{t('log.columns.case')}</TH>
            </TRow>
          </THead>
          <TBody>
            {groupByDay(events, now).map((group) => (
              <Fragment key={group.key}>
                <tr>
                  <th
                    colSpan={4}
                    scope="colgroup"
                    className="border-b border-border-soft bg-subtle px-7 py-1.5 text-left text-12 font-semibold text-muted"
                  >
                    {group.label}
                  </th>
                </tr>
                {group.events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    selected={event.id === selectedEventId}
                    onSelect={() => onSelect(event.id)}
                  />
                ))}
              </Fragment>
            ))}
          </TBody>
        </Table>
        <div className="flex flex-col items-center gap-2 px-7 py-4">
          <span className="text-13 text-muted">{shownCountLabel(events.length)}</span>
          {hasMore ? (
            <Button variant="secondary" size="sm" loading={loadingMore} onClick={onLoadMore}>
              {t('log.loadMore')}
            </Button>
          ) : null}
          {loadMoreFailed ? (
            <span role="alert" className="text-13 text-danger-strong">
              {t('log.loadMoreFailed')}
            </span>
          ) : null}
        </div>
      </>
    )
  }

  return (
    <section aria-label={t('log.region')} className="min-w-0 grow scrollbar-thin overflow-y-auto">
      {body}
    </section>
  )
}

interface EventRowProps {
  event: AuditEvent
  selected: boolean
  onSelect(): void
}

function EventRow({ event, selected, onSelect }: EventRowProps) {
  const { t } = useTranslation('audit')
  const { actor } = event
  return (
    <TRow selected={selected} onSelect={onSelect}>
      <TCell muted numeric className="pl-7">
        {eventTime(event.occurredAt)}
      </TCell>
      <TCell className="max-w-[260px]">
        <span className="flex min-w-0 items-center gap-2">
          <Badge tone={actorTone(actor.role)} size="sm">
            {actorRoleLabel(actor.role)}
          </Badge>
          {!showsActorName(actor.role) ? null : (
            <span className="truncate" title={actor.id}>
              {actorName(actor)}
            </span>
          )}
        </span>
      </TCell>
      <TCell>
        <TRowSelect className="flex items-center gap-2">
          <span>{event.description}</span>
          {event.changesState ? (
            <span className="shrink-0 text-11 font-semibold text-warn">{t('log.changes')}</span>
          ) : null}
        </TRowSelect>
      </TCell>
      <TCell className="pr-7">
        {event.caseRef ? (
          <span className="font-mono text-12 text-ink-2" title={event.caseRef.id}>
            {shortCaseId(event.caseRef.id)}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </TCell>
    </TRow>
  )
}

function LogSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2 px-7 py-4">
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <Skeleton key={key} className="h-9 w-full" />
      ))}
    </div>
  )
}
