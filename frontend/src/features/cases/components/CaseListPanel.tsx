import { PanelLeftClose } from 'lucide-react'
import {
  FilterTile,
  FilterTileGroup,
  IconButton,
  QueryState,
  SearchInput,
  Skeleton,
} from '@/components/ui'
import { useDebouncedValue, useInbox, useInboxLive, useNow } from '../hooks'
import {
  INBOX_FILTERS,
  SEARCH_MAX_LENGTH,
  countForFilter,
  emptyListCopy,
  normalizeSearch,
} from '../model'
import type { InboxResponse, InboxStatus } from '../types'
import { AvailabilityToggle } from './AvailabilityToggle'
import { CaseCard } from './CaseCard'
import { CollapsedCaseRail } from './CollapsedCaseRail'
import { PausedNotice } from './PausedNotice'

export interface CaseListPanelProps {
  selectedCaseId: string | null
  /** `null` = Todos (open cases); `closed` = Cerrados (read-only, last 7 days). */
  filter: InboxStatus | null
  query: string
  collapsed: boolean
  onSelectCase(caseId: string): void
  /**
   * "Ver caso" in the new-case toast (defaults to `onSelectCase`). The toast
   * goes away, so the screen should also move the focus to the opened case.
   */
  onOpenNotifiedCase?(caseId: string): void
  onFilterChange(filter: InboxStatus | null): void
  onQueryChange(query: string): void
  onCollapsedChange(collapsed: boolean): void
}

/** Search waits for a short pause in typing before it hits the API. */
const SEARCH_DEBOUNCE_MS = 250
/** SLA countdowns and "hace x" tick every 30 s (contract §4.5). */
const TICK_MS = 30_000

/**
 * The "Casos" column of the Workspace: availability, the five status counters
 * (which ARE the filters: Todos · Por responder · Nuevos · Esperando al cliente ·
 * Cerrados), search and the case cards; or, collapsed, a rail of initials of the
 * open cases. Owns the inbox query and its live updates.
 */
export function CaseListPanel({
  selectedCaseId,
  filter,
  query,
  collapsed,
  onSelectCase,
  onOpenNotifiedCase,
  onFilterChange,
  onQueryChange,
  onCollapsedChange,
}: CaseListPanelProps) {
  const q = normalizeSearch(useDebouncedValue(query, SEARCH_DEBOUNCE_MS))
  const inbox = useInbox({ status: filter, q })
  useInboxLive(onOpenNotifiedCase ?? onSelectCase, selectedCaseId)

  const items = inbox.data?.items
  const now = useNow(TICK_MS)

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

  const counts = inbox.data?.counts
  const searching = q !== ''

  return (
    <section
      aria-label="Casos abiertos"
      className="flex h-full w-[320px] shrink-0 flex-col border-r border-border bg-panel"
    >
      <div className="flex flex-col gap-3 px-4 pt-[18px] pb-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="m-0 font-display text-20 font-bold">Casos</h1>
          <div className="flex items-center gap-1.5">
            <AvailabilityToggle />
            <IconButton
              size="sm"
              aria-label="Contraer la lista"
              title="Contraer"
              icon={<PanelLeftClose size={16} />}
              onClick={() => onCollapsedChange(true)}
            />
          </div>
        </div>

        <FilterTileGroup aria-label="Filtrar casos" columns={3}>
          {INBOX_FILTERS.map((option) => (
            <FilterTile
              key={option.label}
              label={option.label}
              tone={option.tone}
              count={counts ? countForFilter(counts, option.status) : '–'}
              selected={filter === option.status}
              onSelect={() => onFilterChange(option.status)}
            />
          ))}
        </FilterTileGroup>

        <SearchInput
          aria-label="Buscar caso"
          placeholder="Buscar por cliente o número"
          value={query}
          maxLength={SEARCH_MAX_LENGTH}
          onChange={(event) => onQueryChange(event.target.value)}
        />

        <PausedNotice />
      </div>

      <div className="min-h-0 grow scrollbar-thin overflow-y-auto [&>[role=alert]]:mx-4 [&>[role=alert]]:mb-4">
        <QueryState<InboxResponse>
          query={inbox}
          skeleton={<CaseListSkeleton />}
          isEmpty={(data) => data.items.length === 0}
          empty={
            <p className="m-0 border-t border-border p-4 text-14 text-ink-2">
              {emptyListCopy(filter, searching)}
            </p>
          }
          errorTitle="No pudimos cargar tus casos"
        >
          {(data) => (
            <ul aria-label="Casos" className="m-0 list-none p-0">
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
