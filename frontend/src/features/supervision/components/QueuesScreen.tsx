import { Flame, Info, Languages } from 'lucide-react'
import { Page, PageBody } from '@/components/layout'
import {
  Avatar,
  Button,
  EmptyState,
  Fact,
  FilterChips,
  FilterMenu,
  PageHeader,
  QueryState,
  Skeleton,
  StatusIcon,
  TBody,
  TCell,
  TH,
  THead,
  TRow,
  Table,
  activeFilterChips,
  toggleFilter,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useNow } from '@/lib/hooks'
import {
  AUTOMATIC_ASSIGNMENT_NOTE,
  QUEUE_LANGUAGES,
  emptyQueueTitle,
  filterOpenCases,
  firstResponseFact,
  languageWord,
  openForText,
  queueFiguresFromRows,
  queueFilterGroups,
  queueNavLabels,
  queuesSelection,
  queuesStateFromSelection,
  shownCasesLabel,
  type QueueNavFigures,
  withoutKey,
} from '../model'
import type { QueuesUrlState, UrlStateChangeOptions } from '../url'
import { useOpenCases, useQueueOverview, useSupervisionLive } from '../hooks'
import type { Language, LanguageOpenCases, OpenCaseRow } from '../types'
import { CaseCustomerCell, CaseStatusCell } from './CaseCells'

/** Clock of the screen: first-response levels, "Abierto", risk counts (minute resolution). */
export const SUPERVISION_TICK_MS = 15_000

export interface QueuesScreenProps {
  state: QueuesUrlState
  onStateChange(patch: Partial<QueuesUrlState>, options?: UrlStateChangeOptions): void
  /** Open the read-only case view (the route carries the return URL). */
  onOpenCase(caseId: string): void
}

/**
 * "Colas" (SuColas.dc.html, slice 9): the language queues with their figures and, for the
 * selected one, every open case of that language: who holds it, its status, how long it
 * has been open and its first response. Assignment is automatic: nothing to assign here;
 * a row opens the case view. Filters: one "Filtros" dropdown + chips, in the URL.
 */
export function QueuesScreen({ state, onStateChange, onOpenCase }: QueuesScreenProps) {
  useSupervisionLive()
  const now = useNow(SUPERVISION_TICK_MS)
  const overview = useQueueOverview()
  const openCases = useOpenCases(state.language)
  const rows = openCases.data?.cases

  function figuresOf(language: Language): QueueNavFigures | null {
    if (language === state.language && rows) return queueFiguresFromRows(rows, now)
    const queue = overview.data?.queues.find((q) => q.language === language)
    return queue
      ? { open: queue.openCases, unassigned: queue.waiting, atRisk: queue.openAtRisk }
      : null
  }

  return (
    <Page
      header={
        <PageHeader
          title="Colas"
          subtitle="Todos los casos abiertos, por idioma"
          actions={
            <p className="m-0 flex max-w-[460px] items-start gap-2 text-13 text-ink-2">
              <Info size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
              <span>{AUTOMATIC_ASSIGNMENT_NOTE}</span>
            </p>
          }
        />
      }
    >
      <PageBody
        scroll={false}
        className="grid grid-cols-[260px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-4"
      >
        <nav aria-labelledby="queues-heading" className="flex flex-col gap-2">
          <h2
            id="queues-heading"
            className="m-0 text-12 font-semibold tracking-kicker text-muted uppercase"
          >
            Idioma
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {QUEUE_LANGUAGES.map((language) => (
              <li key={language}>
                <QueueButton
                  language={language}
                  figures={figuresOf(language)}
                  selected={language === state.language}
                  onSelect={() => onStateChange({ language, analysts: [] }, { replace: true })}
                />
              </li>
            ))}
          </ul>
        </nav>
        <QueueCases
          query={openCases}
          state={state}
          now={now}
          onStateChange={onStateChange}
          onOpenCase={onOpenCase}
        />
      </PageBody>
    </Page>
  )
}

interface QueueButtonProps {
  language: Language
  figures: QueueNavFigures | null
  selected: boolean
  onSelect(): void
}

function QueueButton({ language, figures, selected, onSelect }: QueueButtonProps) {
  const labels = figures ? queueNavLabels(figures) : null
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full cursor-pointer flex-col gap-1.5 rounded-12 px-3.5 py-3 text-left',
        selected
          ? 'border-2 border-ink bg-surface'
          : 'border border-border bg-transparent hover:bg-surface',
      )}
    >
      <span className="flex items-center gap-2 text-15 font-semibold text-ink">
        <Languages size={16} aria-hidden="true" className="text-muted" />
        {languageWord(language)}
      </span>
      {labels && figures ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-13">
          <span className="text-ink-2">{labels.open}</span>
          <span className={cn(figures.unassigned > 0 ? 'font-semibold text-danger' : 'text-ink-2')}>
            {labels.unassigned}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1',
              figures.atRisk > 0 ? 'font-semibold text-warn' : 'text-ink-2',
            )}
          >
            {figures.atRisk > 0 ? <Flame size={13} aria-hidden="true" /> : null}
            {labels.atRisk}
          </span>
        </span>
      ) : (
        <Skeleton className="h-4 w-40" />
      )}
    </button>
  )
}

interface QueueCasesProps {
  query: ReturnType<typeof useOpenCases>
  state: QueuesUrlState
  now: number
  onStateChange(patch: Partial<QueuesUrlState>, options?: UrlStateChangeOptions): void
  onOpenCase(caseId: string): void
}

function QueueCases({ query, state, now, onStateChange, onOpenCase }: QueueCasesProps) {
  const title = languageWord(state.language)
  const rows = query.data?.cases ?? []
  const groups = queueFilterGroups(rows, state)
  const selection = queuesSelection(state)
  const chips = activeFilterChips(groups, selection)
  const update = (next: ReturnType<typeof toggleFilter>) =>
    onStateChange(queuesStateFromSelection(state, next), { replace: true })
  const clear = () =>
    onStateChange({ statuses: [], priorities: [], analysts: [] }, { replace: true })
  const shown = filterOpenCases(rows, state)

  return (
    <section
      aria-labelledby="queue-title"
      className="flex min-h-0 flex-col overflow-hidden rounded-12 border border-border bg-surface"
    >
      <div className="flex flex-col gap-2 px-4 pt-3.5 pb-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="queue-title" className="m-0 text-16 font-semibold">
              {title}
            </h2>
            {query.data ? (
              <span className="text-13 text-muted">
                {shownCasesLabel(shown.length, rows.length, chips.length > 0)}
              </span>
            ) : null}
          </div>
          <FilterMenu
            groups={groups}
            selection={selection}
            align="end"
            onToggle={(group, value) => update(toggleFilter(selection, group, value))}
            onClear={clear}
          />
        </div>
        <FilterChips
          chips={chips}
          onRemove={(group, value) => update(toggleFilter(selection, group, value))}
        />
      </div>
      <QueryState
        query={query}
        skeleton={<RowsSkeleton />}
        errorTitle="No pudimos cargar los casos"
      >
        {(data: LanguageOpenCases) => {
          if (data.cases.length === 0) {
            return (
              <div className="border-t border-border-soft px-4 py-10">
                <EmptyState
                  as="h3"
                  title={emptyQueueTitle(state.language)}
                  description="Cuando un cliente escriba en este idioma, su caso aparece aquí."
                />
              </div>
            )
          }
          if (shown.length === 0) {
            return (
              <div className="flex flex-col items-center gap-2 border-t border-border-soft px-4 py-8 text-14 text-muted">
                <span>Ningún caso coincide con los filtros.</span>
                <Button size="sm" variant="secondary" onClick={clear}>
                  Limpiar filtros
                </Button>
              </div>
            )
          }
          return (
            <Table
              aria-label={`Casos abiertos en ${title.toLowerCase()}`}
              stickyHeader
              density="comfortable"
              wrapperClassName="grow"
            >
              <THead>
                <TRow>
                  <TH className={CELL_X}>Cliente</TH>
                  <TH className={CELL_X}>Estado</TH>
                  <TH className={CELL_X}>Abierto</TH>
                  <TH className={CELL_X}>Primera respuesta</TH>
                  <TH className={CELL_X}>Lo tiene</TH>
                </TRow>
              </THead>
              <TBody>
                {shown.map((row) => (
                  <OpenCaseTableRow key={row.case.id} row={row} now={now} onOpenCase={onOpenCase} />
                ))}
              </TBody>
            </Table>
          )
        }}
      </QueryState>
    </section>
  )
}

const CELL_X = 'px-3'

interface OpenCaseTableRowProps {
  row: OpenCaseRow
  now: number
  onOpenCase(caseId: string): void
}

function OpenCaseTableRow({ row, now, onOpenCase }: OpenCaseTableRowProps) {
  const summary = row.case
  const firstResponse = firstResponseFact(summary, now)
  return (
    <TRow onSelect={() => onOpenCase(summary.id)}>
      <TCell className={cn(CELL_X, 'max-w-[260px]')}>
        <CaseCustomerCell summary={summary} onOpenCase={onOpenCase} />
      </TCell>
      <TCell className={CELL_X}>
        <CaseStatusCell summary={summary} />
      </TCell>
      <TCell muted className={cn(CELL_X, 'whitespace-nowrap')}>
        {openForText(summary, now)}
      </TCell>
      <TCell className={cn(CELL_X, 'whitespace-nowrap')}>
        <Fact
          {...withoutKey(firstResponse)}
          size="md"
          className={
            firstResponse.tone === 'danger' || firstResponse.tone === 'warn'
              ? 'font-semibold'
              : undefined
          }
        />
      </TCell>
      <TCell className={CELL_X}>
        {row.assigneeName ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={row.assigneeName} size="sm" tone="neutral" decorative />
            <span className="truncate text-14">{row.assigneeName}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-14 text-muted">
            <StatusIcon shape="dashed" tone="neutral" size={16} />
            Sin asignar
          </span>
        )}
      </TCell>
    </TRow>
  )
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2 border-t border-border-soft px-4 py-3">
      {[0, 1, 2, 3, 4].map((key) => (
        <Skeleton key={key} className="h-9 w-full" />
      ))}
    </div>
  )
}
