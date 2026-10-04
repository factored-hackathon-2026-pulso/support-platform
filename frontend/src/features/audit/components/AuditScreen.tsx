import { useCallback, useMemo } from 'react'
import { Page, PageBody } from '@/components/layout'
import { PageHeader } from '@/components/ui'
import { auditFiltersOf, clearAuditFilters, dateRangeError, hasAuditFilters } from '../model'
import type { AuditStateChangeOptions, AuditUrlState } from '../url'
import { useNow } from '@/lib/hooks'
import { useAuditEvent, useAuditEvents } from '../hooks'
import { AuditDetail } from './AuditDetail'
import { AuditLog } from './AuditLog'
import { AuditSearch, AuditToolbar } from './AuditToolbar'

/** Clock of the day separators ("Hoy", "Ayer"). */
const DAY_TICK_MS = 60_000

export interface AuditScreenProps {
  state: AuditUrlState
  onStateChange(patch: Partial<AuditUrlState>, options?: AuditStateChangeOptions): void
  /**
   * The viewer may open the supervisor case view (default true). The admin entry
   * point passes `hasRole('supervisor')`: without it "Ver la conversación" is
   * hidden (slice 4 §7.2).
   */
  canOpenCases?: boolean
}

/**
 * Auditoría (SuAudit.dc.html, contract §8.8): who did what, on which case and
 * when, from the event log. Filters, the search and the selected event live in
 * the URL (`?actor=&person=&case=&type=&from=&to=&q=&changes=&event=`).
 * Read on demand: no realtime ("Actualizar" refetches). No export. The queue
 * notice of the supervision screens is mounted by the route (features/audit
 * does not import features/supervision).
 */
export function AuditScreen({ state, onStateChange, canOpenCases = true }: AuditScreenProps) {
  const now = useNow(DAY_TICK_MS)
  const query = useMemo(() => auditFiltersOf(state), [state])
  const blocked = dateRangeError(state) !== null
  const events = useAuditEvents(query, !blocked)
  const items = useMemo(() => events.data?.pages.flatMap((page) => page.items) ?? [], [events.data])

  const loaded = state.eventId ? items.find((event) => event.id === state.eventId) : undefined
  // Not in the loaded pages (a shared link, a filter that hides it): fetch it by id.
  const byId = useAuditEvent(state.eventId, events.status !== 'pending' && !loaded)

  const replace = useCallback(
    (patch: Partial<AuditUrlState>) => onStateChange(patch, { replace: true }),
    [onStateChange],
  )
  const onQueryChange = useCallback((q: string) => replace({ query: q }), [replace])

  return (
    <Page
      header={
        <PageHeader
          title="Auditoría"
          subtitle="Quién hizo qué, en qué caso y cuándo"
          actions={<AuditSearch value={state.query} onChange={onQueryChange} />}
        />
      }
      toolbar={
        <AuditToolbar
          state={state}
          onStateChange={onStateChange}
          refreshing={events.isRefetching && !events.isFetchingNextPage}
          onRefresh={() => void events.refetch()}
        />
      }
    >
      <PageBody scroll={false} padded={false} className="flex">
        <AuditLog
          status={events.status}
          events={items}
          filtered={hasAuditFilters(state)}
          blocked={blocked}
          selectedEventId={state.eventId}
          now={now}
          hasMore={events.hasNextPage}
          loadingMore={events.isFetchingNextPage}
          loadMoreFailed={events.isFetchNextPageError}
          retrying={events.isFetching}
          onSelect={(eventId) => onStateChange({ eventId })}
          onLoadMore={() => void events.fetchNextPage()}
          onRetry={() => void events.refetch()}
          onClearFilters={() => replace(clearAuditFilters(state))}
        />
        <AuditDetail
          eventId={state.eventId}
          event={loaded ?? byId.data}
          loading={byId.isFetching}
          error={loaded ? null : byId.error}
          onRetry={() => void byId.refetch()}
          onFilterByCase={(caseId) => replace({ caseId })}
          canOpenCases={canOpenCases}
        />
      </PageBody>
    </Page>
  )
}
