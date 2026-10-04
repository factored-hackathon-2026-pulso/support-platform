import { useCallback, useEffect, useState } from 'react'
import { CircleArrowUp } from 'lucide-react'
import { Page, PageBody } from '@/components/layout'
import { EmptyState, Fact, PageHeader, QueryState, Skeleton, Status } from '@/components/ui'
import { ESCALATION_STATE, escalationWaitFact } from '@/features/cases'
import { cn } from '@/lib/cn'
import { useNow } from '@/lib/hooks'
import {
  escalationGroups,
  openEscalationsLabel,
  type EscalationsUrlState,
  type UrlStateChangeOptions,
  withoutKey,
} from '../model'
import { useEscalationOverview, useSupervisionLive, useSupervisionNotices } from '../hooks'
import type { EscalationItem, EscalationOverview } from '../types'
import { AnalystAvatar } from './AnalystAvatar'
import { EscalationPanel } from './EscalationPanel'
import { SUPERVISION_TICK_MS } from './QueuesScreen'
import { ResultStrip } from './ResultStrip'

export interface EscalationsScreenProps {
  state: EscalationsUrlState
  onStateChange(patch: Partial<EscalationsUrlState>, options?: UrlStateChangeOptions): void
  /** Open the read-only case view (the route carries the return URL). */
  onOpenCase(caseId: string): void
}

/**
 * "Escalados" (SuEscalados.dc.html, slice 9): the cases in which the team asked
 * supervision for help. Open ones first (the longest waiting first; a clock, an orange
 * flame after 15 min and a red one after 30: emphasis only, no deadline), then the ones
 * attended today. Selecting one opens the panel (`?escalamiento=`): the motive, the case
 * facts, the last messages, and Responder / Tomar el caso / Reasignar.
 */
export function EscalationsScreen({ state, onStateChange, onOpenCase }: EscalationsScreenProps) {
  useSupervisionLive()
  useSupervisionNotices({ escalations: false })
  const overview = useEscalationOverview()
  const now = useNow(SUPERVISION_TICK_MS)
  const [result, setResult] = useState<{ message: string } | null>(null)

  const items = overview.data?.items ?? []
  const selected = state.escalationId
    ? (items.find((item) => item.escalation.id === state.escalationId) ?? null)
    : null
  // ?escalamiento= no longer listed (withdrawn, ended with the case, older than today).
  const unknown =
    state.escalationId !== null &&
    overview.status === 'success' &&
    !overview.isFetching &&
    !selected
  useEffect(() => {
    if (unknown) onStateChange({ escalationId: null, reassign: false }, { replace: true })
  }, [unknown, onStateChange])

  const select = useCallback(
    (escalationId: string) => onStateChange({ escalationId, reassign: false }),
    [onStateChange],
  )

  return (
    <Page
      header={
        <PageHeader
          title="Escalados"
          subtitle="Casos en los que el equipo pidió ayuda de supervisión"
          actions={
            overview.data ? (
              <span className="text-14 font-medium text-ink-2">
                {openEscalationsLabel(overview.data.openCount)}
              </span>
            ) : null
          }
        />
      }
      toolbar={<ResultStrip result={result} onDismiss={() => setResult(null)} />}
    >
      <PageBody
        scroll={false}
        className={cn(
          'grid grid-rows-[minmax(0,1fr)] gap-4',
          selected ? 'grid-cols-[minmax(0,1fr)_440px]' : 'grid-cols-1',
        )}
      >
        <section
          aria-label="Escalamientos"
          className="flex min-h-0 flex-col overflow-hidden rounded-12 border border-border bg-surface"
        >
          <QueryState
            query={overview}
            skeleton={<ListSkeleton />}
            errorTitle="No pudimos cargar los escalamientos"
          >
            {(data: EscalationOverview) => (
              <EscalationList
                data={data}
                now={now}
                selectedId={selected?.escalation.id ?? null}
                onSelect={select}
              />
            )}
          </QueryState>
        </section>
        {selected ? (
          <EscalationPanel
            key={selected.escalation.id}
            item={selected}
            now={now}
            reassigning={state.reassign}
            onReassign={(open) => onStateChange({ reassign: open }, { replace: !open })}
            onClose={() => onStateChange({ escalationId: null, reassign: false })}
            onOpenCase={onOpenCase}
            onResult={setResult}
          />
        ) : null}
      </PageBody>
    </Page>
  )
}

interface EscalationListProps {
  data: EscalationOverview
  now: number
  selectedId: string | null
  onSelect(escalationId: string): void
}

function EscalationList({ data, now, selectedId, onSelect }: EscalationListProps) {
  const groups = escalationGroups(data.items, now)
  if (groups.length === 0) {
    return (
      <div className="flex grow items-center justify-center p-10">
        <EmptyState
          icon={<CircleArrowUp size={28} aria-hidden="true" />}
          title="Nadie escaló un caso"
          description="Cuando alguien del equipo escale un caso, aparece aquí y te avisamos."
        />
      </div>
    )
  }
  return (
    <div className="flex min-h-0 grow flex-col overflow-y-auto">
      <div
        aria-hidden="true"
        className={cn(
          ROW_GRID,
          'sticky top-0 z-[1] border-b border-border-soft bg-surface px-4 py-2 text-12 font-semibold tracking-label text-muted uppercase',
        )}
      >
        <span>Analista</span>
        <span>Cliente</span>
        <span>Motivo</span>
        <span>Esperando</span>
        <span>Estado</span>
      </div>
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col">
          <h2 className="m-0 bg-canvas px-4 py-1.5 text-12 font-semibold tracking-kicker text-muted uppercase">
            {group.label}
          </h2>
          <ul className="m-0 list-none p-0">
            {group.items.map((item) => (
              <EscalationRow
                key={item.escalation.id}
                item={item}
                now={now}
                selected={item.escalation.id === selectedId}
                onSelect={() => onSelect(item.escalation.id)}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

const ROW_GRID =
  'grid grid-cols-[minmax(150px,200px)_minmax(140px,200px)_minmax(0,1fr)_96px_122px] items-center gap-3'

interface EscalationRowProps {
  item: EscalationItem
  now: number
  selected: boolean
  onSelect(): void
}

function EscalationRow({ item, now, selected, onSelect }: EscalationRowProps) {
  const { escalation } = item
  const wait = escalationWaitFact(escalation, now)
  const analyst = escalation.escalatedByName ?? 'Alguien del equipo'
  return (
    <li className="border-b border-canvas">
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className={cn(
          ROW_GRID,
          'w-full cursor-pointer px-4 py-2.5 text-left text-14',
          selected ? 'bg-subtle shadow-[inset_3px_0_0_var(--color-ink)]' : 'hover:bg-subtle',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <AnalystAvatar name={analyst} />
          <span className={cn('truncate', selected && 'font-semibold')}>{analyst}</span>
        </span>
        <span className="truncate">{escalation.customerName}</span>
        <span className="truncate text-ink-2">{escalation.motive}</span>
        <Fact
          {...withoutKey(wait)}
          focusable={false}
          className={wait.level !== 'normal' ? 'font-semibold' : undefined}
        />
        <Status {...ESCALATION_STATE[escalation.state]} />
      </button>
    </li>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {[0, 1, 2, 3].map((key) => (
        <Skeleton key={key} className="h-9 w-full" />
      ))}
    </div>
  )
}
