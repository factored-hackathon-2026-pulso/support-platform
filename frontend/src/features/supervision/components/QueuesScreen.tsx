import { Bot, Flame, Info } from 'lucide-react'
import { useAiEnabled } from '@/app/platform'
import { Page, PageBody } from '@/components/layout'
import {
  Avatar,
  Button,
  EmptyState,
  Fact,
  FilterChips,
  FilterMenu,
  LanguageMarks,
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
  useToast,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useNow } from '@/lib/hooks'
import { useTranslation } from '@/lib/i18n'
import {
  assistantHolder,
  automaticAssignmentNote,
  describeReleaseFailure,
  isWithAssistant,
  takeFromAssistantLabel,
  takenFromAssistantToast,
  QUEUE_LABEL,
  QUEUE_LANGUAGES,
  emptyQueueTitle,
  filterOpenCases,
  firstResponseFact,
  openCasesTableLabel,
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
import {
  useOpenCases,
  useQueueOverview,
  useReleaseFromAssistant,
  useSupervisionLive,
} from '../hooks'
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
  const { t } = useTranslation('supervision')
  useSupervisionLive()
  const now = useNow(SUPERVISION_TICK_MS)
  const aiEnabled = useAiEnabled()
  const overview = useQueueOverview()
  const openCases = useOpenCases(state.language)
  // Slice 19: with AI on, the other queue's rows too, so its card says "N con el asistente".
  const other = QUEUE_LANGUAGES.find((language) => language !== state.language) ?? 'pt'
  const otherCases = useOpenCases(other, { enabled: aiEnabled })
  const rows = openCases.data?.cases

  function figuresOf(language: Language): QueueNavFigures | null {
    if (language === state.language && rows) return queueFiguresFromRows(rows, now)
    if (language === other && aiEnabled && otherCases.data) {
      return queueFiguresFromRows(otherCases.data.cases, now)
    }
    const queue = overview.data?.queues.find((q) => q.language === language)
    return queue
      ? {
          open: queue.openCases,
          unassigned: queue.waiting,
          atRisk: queue.openAtRisk,
          withAssistant: 0,
        }
      : null
  }

  return (
    <Page
      header={
        <PageHeader
          title={t('queues.title')}
          subtitle={t('queues.subtitle')}
          actions={
            <p className="m-0 flex max-w-[460px] items-start gap-2 text-13 text-ink-2">
              <Info size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
              <span>{automaticAssignmentNote()}</span>
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
            {t('queues.languageHeading')}
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
          aiEnabled={aiEnabled}
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
  useTranslation('supervision') // the figures' copy follows a language switch
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
      <LanguageMarks
        languages={[language]}
        name={QUEUE_LABEL[language]}
        focusable={false}
        size="lg"
        className="text-ink"
      />
      {labels && figures ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-13">
          <span className="text-ink-2">{labels.open}</span>
          <span className={cn(figures.unassigned > 0 ? 'font-semibold text-danger' : 'text-ink-2')}>
            {labels.unassigned}
          </span>
          {figures.withAssistant > 0 ? (
            <span className="inline-flex items-center gap-1 text-accent-strong">
              <Bot size={14} aria-hidden="true" />
              {labels.withAssistant}
            </span>
          ) : null}
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
  aiEnabled: boolean
  onStateChange(patch: Partial<QueuesUrlState>, options?: UrlStateChangeOptions): void
  onOpenCase(caseId: string): void
}

function QueueCases({ query, state, now, aiEnabled, onStateChange, onOpenCase }: QueueCasesProps) {
  const { t } = useTranslation(['supervision', 'common'])
  const title = QUEUE_LABEL[state.language]
  const rows = query.data?.cases ?? []
  const groups = queueFilterGroups(rows, state, { aiEnabled })
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
            <h2 id="queue-title" className="m-0 flex text-16 font-semibold">
              <LanguageMarks
                languages={[state.language]}
                name={title}
                focusable={false}
                size="lg"
                className="text-ink"
              />
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
      <QueryState query={query} skeleton={<RowsSkeleton />} errorTitle={t('queues.loadError')}>
        {(data: LanguageOpenCases) => {
          if (data.cases.length === 0) {
            return (
              <div className="border-t border-border-soft px-4 py-10">
                <EmptyState
                  as="h3"
                  title={emptyQueueTitle(state.language)}
                  description={t('queues.emptyText')}
                />
              </div>
            )
          }
          if (shown.length === 0) {
            return (
              <div className="flex flex-col items-center gap-2 border-t border-border-soft px-4 py-8 text-14 text-muted">
                <span>{t('queues.noMatch')}</span>
                <Button size="sm" variant="secondary" onClick={clear}>
                  {t('common:filters.clear')}
                </Button>
              </div>
            )
          }
          return (
            <Table
              aria-label={openCasesTableLabel(state.language)}
              stickyHeader
              density="comfortable"
              wrapperClassName="grow"
            >
              <THead>
                <TRow>
                  <TH className={CELL_X}>{t('queues.columns.customer')}</TH>
                  <TH className={CELL_X}>{t('queues.columns.status')}</TH>
                  <TH className={CELL_X}>{t('queues.columns.openFor')}</TH>
                  <TH className={CELL_X}>{t('queues.columns.firstResponse')}</TH>
                  <TH className={CELL_X}>{t('queues.columns.holder')}</TH>
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
  const { t } = useTranslation('supervision')
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
        {isWithAssistant(summary) ? (
          <AssistantHolder summary={summary} />
        ) : row.assigneeName ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={row.assigneeName} size="sm" tone="neutral" decorative />
            <span className="truncate text-14">{row.assigneeName}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-14 text-muted">
            <StatusIcon shape="dashed" tone="neutral" size={16} />
            {t('unassigned')}
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

/**
 * "Lo tiene" of a case the assistant holds (slice 19, IaSuColas): the bot avatar, "Asistente
 * virtual" and "Tomar el caso" (`POST …/assistant/release`: it goes to its language queue). The
 * row itself still opens the case view (its transcript shows the assistant's turns).
 */
function AssistantHolder({ summary }: { summary: OpenCaseRow['case'] }) {
  const { t } = useTranslation('supervision')
  const release = useReleaseFromAssistant(summary.id)
  const { toast } = useToast()
  return (
    <span className="flex min-w-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong"
        >
          <Bot size={14} />
        </span>
        <span className="truncate text-14">{assistantHolder()}</span>
      </span>
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0"
        loading={release.isPending}
        aria-label={takeFromAssistantLabel(summary.customer.displayName)}
        onClick={() =>
          release.mutate(undefined, {
            onSuccess: (taken) => toast(takenFromAssistantToast(taken)),
            onError: (error) => toast({ ...describeReleaseFailure(error), politeness: 'alert' }),
          })
        }
      >
        {t('actions.take')}
      </Button>
    </span>
  )
}
