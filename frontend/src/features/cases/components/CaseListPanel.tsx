import { useMemo } from 'react'
import { PanelLeftClose, X } from 'lucide-react'
import { IconButton, QueryState, SearchInput, Skeleton, StatusIcon } from '@/components/ui'
import { useDebouncedValue, useNow } from '@/lib/hooks'
import { useTranslation } from '@/lib/i18n'
import { useInbox, useInboxLive } from '../hooks'
import {
  SEARCH_MAX_LENGTH,
  emptyListCopy,
  caseStatus,
  filterChipLabel,
  normalizeSearch,
  sortByUrgency,
} from '../model'
import type { InboxResponse, InboxStatus } from '../types'
import { AvailabilityToggle } from './AvailabilityToggle'
import { CaseCard } from './CaseCard'
import { CollapsedCaseRail } from './CollapsedCaseRail'

export interface CaseListPanelProps {
  selectedCaseId: string | null
  /**
   * `null` = every open case (the default); a status (from Inicio's tiles or the
   * URL) shows a removable chip; `closed` = Cerrados (read-only, last 7 days).
   */
  filter: InboxStatus | null
  query: string
  collapsed: boolean
  onSelectCase(caseId: string): void
  onFilterChange(filter: InboxStatus | null): void
  onQueryChange(query: string): void
  onCollapsedChange(collapsed: boolean): void
}

/** Search waits for a short pause in typing before it hits the API. */
const SEARCH_DEBOUNCE_MS = 250
/** SLA countdowns and "hace x" tick every 30 s (contract §4.5). */
const TICK_MS = 30_000

/**
 * The "Casos" column of the Workspace (slice 6 §4.3): availability (the control
 * is also the pause indicator), search, the filter chip when the URL carries a
 * filter (the status tiles live on Inicio), and one flat list of the open cases
 * in urgency order (`sortByUrgency`, the same order as Inicio's "Lo primero");
 * Cerrados keeps the most recent close first. Collapsed: a rail of initials of
 * the open cases. Owns the inbox query and its live updates.
 */
export function CaseListPanel({
  selectedCaseId,
  filter,
  query,
  collapsed,
  onSelectCase,
  onFilterChange,
  onQueryChange,
  onCollapsedChange,
}: CaseListPanelProps) {
  const { t } = useTranslation(['cases', 'common'])
  const q = normalizeSearch(useDebouncedValue(query, SEARCH_DEBOUNCE_MS))
  const inbox = useInbox({ status: filter, q })
  useInboxLive()

  const now = useNow(TICK_MS)
  const data = inbox.data
  const ordered = useMemo(
    () => (data && filter !== 'closed' ? { ...data, items: sortByUrgency(data.items, now) } : data),
    [data, filter, now],
  )
  const items = ordered?.items

  if (collapsed) {
    return (
      <CollapsedCaseRail
        items={items?.filter((item) => item.status !== 'closed')}
        toReplyCount={inbox.data?.counts.toReply}
        selectedCaseId={selectedCaseId}
        onSelectCase={onSelectCase}
        onExpand={() => onCollapsedChange(false)}
      />
    )
  }

  const searching = q !== ''
  const chip = filterChipLabel(filter)

  return (
    <section
      aria-label={t('list.region')}
      className="flex h-full w-[320px] shrink-0 flex-col border-r border-border bg-panel"
    >
      <div className="flex flex-col gap-3 px-4 pt-[18px] pb-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="m-0 font-display text-20 font-bold">{t('list.title')}</h1>
          <div className="flex items-center gap-1.5">
            <AvailabilityToggle placement="header" />
            <IconButton
              size="sm"
              aria-label={t('list.collapse')}
              title={t('list.collapseShort')}
              icon={<PanelLeftClose size={16} />}
              onClick={() => onCollapsedChange(true)}
            />
          </div>
        </div>

        <AvailabilityToggle placement="banner" />

        <SearchInput
          aria-label={t('list.search')}
          placeholder={t('list.searchPlaceholder')}
          value={query}
          maxLength={SEARCH_MAX_LENGTH}
          onChange={(event) => onQueryChange(event.target.value)}
        />

        {filter && chip ? (
          <div className="flex items-center gap-2">
            <span className="text-12 text-muted">{t('list.filter')}</span>
            <button
              type="button"
              aria-label={t('common:filters.remove', { label: chip })}
              onClick={() => onFilterChange(null)}
              className="inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pr-1.5 pl-2.5 text-13 font-semibold text-ink hover:bg-subtle"
            >
              <StatusIcon shape={caseStatus(filter).shape} tone={caseStatus(filter).tone} />
              {chip}
              <X size={14} aria-hidden="true" className="text-muted" />
            </button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 grow scrollbar-thin overflow-y-auto [&>[role=alert]]:mx-4 [&>[role=alert]]:mb-4">
        <QueryState<InboxResponse>
          query={{
            status: inbox.status,
            data: ordered,
            isFetching: inbox.isFetching,
            refetch: inbox.refetch,
          }}
          skeleton={<CaseListSkeleton />}
          isEmpty={(data) => data.items.length === 0}
          empty={
            <p className="m-0 border-t border-border p-4 text-14 text-ink-2">
              {emptyListCopy(filter, searching)}
            </p>
          }
          errorTitle={t('list.loadError')}
        >
          {(data) => (
            <ul aria-label={t('list.title')} className="m-0 list-none p-0">
              {data.items.map((summary) => (
                <li key={summary.id}>
                  <CaseCard
                    summary={summary}
                    selected={summary.id === selectedCaseId}
                    now={now}
                    onSelect={onSelectCase}
                  />
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </div>
    </section>
  )
}

function CaseListSkeleton() {
  return (
    <div className="flex flex-col">
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="flex flex-col gap-2 border-t border-l-4 border-border border-l-border py-3 pr-3.5 pl-3"
        >
          <span className="flex justify-between gap-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-12" />
          </span>
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-3 w-44" />
        </div>
      ))}
    </div>
  )
}
