import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, FolderOpen } from 'lucide-react'
import { useCurrentUser } from '@/app/session'
import {
  Button,
  Callout,
  cardClasses,
  EmptyState,
  Fact,
  QueryState,
  Sheet,
  Skeleton,
  Status,
} from '@/components/ui'
import { CloseReasonIcon, caseLifecycleStatus, closeReasonLabel } from '@/features/cases'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { useActiveLocale, useTranslation } from '@/lib/i18n'
import {
  describeCaseLoadFailure,
  historyItemFacts,
  historySheetTitle,
  historyTruncatedNote,
  PREVIOUS_CASES_LIST,
  shortCaseId,
  toTranscriptItems,
  type PreviousCasesSelection,
} from '../model'
import { useCaseDetail, useCaseHistory, useCaseTurns, useLoadOlderTurns } from '../hooks'
import type { CaseHistory } from '../types'
import { ChatTranscript } from './ChatTranscript'

export interface CaseHistorySheetProps {
  /** The case open in the Workspace (its customer's other cases are listed). */
  caseId: string
  customerName: string
  /** `PREVIOUS_CASES_LIST` = the list; a case id = that past case's read-only transcript. */
  selected: PreviousCasesSelection
  onSelect(selected: PreviousCasesSelection): void
  onClose(): void
}

/**
 * "Casos anteriores de {nombre}" (contract §9.4): the customer's other cases
 * with the team, and the read-only transcript of the one picked. Conversation
 * history, not bank data. No composer, no read cursor, no `case:` subscription
 * (a past case is closed and does not change). The URL holds what is shown
 * (`?previous=list | <CASE-id>`).
 *
 * Focus (ARCHITECTURE.md §11): switching view replaces the focused control, so
 * opening a past case moves the focus to its heading, and going back to the
 * list moves it to the row of the case it came from. Opening the sheet straight
 * on a view leaves the initial focus to the Sheet (and its return on close).
 */
export function CaseHistorySheet({
  caseId,
  customerName,
  selected,
  onSelect,
  onClose,
}: CaseHistorySheetProps) {
  const { t } = useTranslation('conversation')
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={historySheetTitle(customerName)}
      description={t('history.description')}
      width={600}
    >
      <CaseHistoryBrowser caseId={caseId} selected={selected} onSelect={onSelect} />
    </Sheet>
  )
}

export interface CaseHistoryBrowserProps {
  /** The case on screen (its customer's other cases are listed). */
  caseId: string
  /** `PREVIOUS_CASES_LIST` = the list; a case id = that past case's read-only transcript. */
  selected: PreviousCasesSelection
  onSelect(selected: PreviousCasesSelection): void
  /** Heading level of the past case and the empty state (h3 in the sheet, h4 in a panel section). */
  headingLevel?: 'h3' | 'h4'
}

/**
 * The content of "Casos anteriores": the list, or one past case's read-only
 * transcript with "Todos los casos anteriores" to go back. Shared by the
 * supervisor's sheet (`CaseHistorySheet`) and the Workspace's "Ficha del
 * cliente" section (slice 6 §5), so both behave the same (focus included).
 */
export function CaseHistoryBrowser({
  caseId,
  selected,
  onSelect,
  headingLevel = 'h3',
}: CaseHistoryBrowserProps) {
  const previous = usePreviousView(selected)
  return selected === PREVIOUS_CASES_LIST ? (
    <HistoryList
      caseId={caseId}
      onSelect={onSelect}
      returnTo={previous}
      headingLevel={headingLevel}
    />
  ) : (
    <PastCase
      key={selected}
      caseId={selected}
      focusHeading={previous !== null}
      onBack={() => onSelect(PREVIOUS_CASES_LIST)}
      headingLevel={headingLevel}
    />
  )
}

/**
 * The view shown before `selected` last changed while the sheet stayed open
 * (`null` until it changes): what the focus returns to.
 */
function usePreviousView(selected: string): string | null {
  const [views, setViews] = useState<{ current: string; previous: string | null }>({
    current: selected,
    previous: null,
  })
  if (views.current !== selected) {
    setViews({ current: selected, previous: views.current })
    return views.current
  }
  return views.previous
}

interface HistoryListProps {
  caseId: string
  onSelect(id: string): void
  /** The view the sheet showed before the list (a past case id): its row takes the focus. */
  returnTo: string | null
  headingLevel: 'h3' | 'h4'
}

function HistoryList({ caseId, onSelect, returnTo, headingLevel }: HistoryListProps) {
  // `cases` too: the rows show the shared case vocabulary (reason, status, rating).
  const { t } = useTranslation(['conversation', 'cases'])
  const history = useCaseHistory(caseId)
  const rows = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef(returnTo)

  // Back from a past case: its row (or the first one) takes the focus, once.
  useEffect(() => {
    if (!pendingFocus.current || !history.data) return
    const target = rows.current.get(pendingFocus.current) ?? rows.current.values().next().value
    pendingFocus.current = null
    target?.focus()
  }, [history.data])

  return (
    <QueryState<CaseHistory>
      query={history}
      skeleton={<ListSkeleton />}
      isEmpty={(data) => data.items.length === 0}
      empty={
        <EmptyState
          icon={<FolderOpen size={36} strokeWidth={1.6} aria-hidden="true" />}
          title={t('history.empty')}
          as={headingLevel}
          size={headingLevel === 'h4' ? 'compact' : 'default'}
        />
      }
      errorTitle={t('history.loadFailed')}
    >
      {(data) => {
        const note = historyTruncatedNote(data.items.length, data.total)
        return (
          <div className="flex flex-col gap-3">
            <ul aria-label={t('history.list')} className="m-0 flex list-none flex-col gap-2 p-0">
              {data.items.map((item) => (
                <li key={item.id}>
                  <button
                    ref={(node) => {
                      if (!node) return
                      rows.current.set(item.id, node)
                      return () => {
                        rows.current.delete(item.id)
                      }
                    }}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      cardClasses({ padding: 'sm', interactive: true }),
                      'flex w-full cursor-pointer items-center gap-3 text-left',
                    )}
                  >
                    <span className="flex min-w-0 grow flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {item.status === 'closed' && item.closeReason ? (
                          <span className="inline-flex items-center gap-1.5 text-13 font-semibold text-ink">
                            <CloseReasonIcon reason={item.closeReason} />
                            {closeReasonLabel(item.closeReason)}
                          </span>
                        ) : (
                          <Status {...caseLifecycleStatus(item.status)} />
                        )}
                        {historyItemFacts(item).map(({ key, ...fact }) => (
                          <Fact key={key} {...fact} focusable={false} />
                        ))}
                      </span>
                      <span className="truncate text-13 text-ink-2">
                        {item.preview ?? t('history.noMessages')}
                      </span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
            {note ? <p className="m-0 text-13 text-muted">{note}</p> : null}
          </div>
        )
      }}
    </QueryState>
  )
}

interface PastCaseProps {
  caseId: string
  /** The sheet switched to this case from the list: its heading takes the focus. */
  focusHeading: boolean
  onBack(): void
  headingLevel: 'h3' | 'h4'
}

function PastCase({ caseId, focusHeading, onBack, headingLevel: Heading }: PastCaseProps) {
  const { t } = useTranslation(['conversation', 'cases', 'common'])
  const locale = useActiveLocale()
  const me = useCurrentUser()
  const detail = useCaseDetail(caseId)
  const turns = useCaseTurns(caseId, detail.data?.case.lastSequence)
  const older = useLoadOlderTurns(caseId)
  // The locale too: the items carry translated words ("Tú").
  const items = useMemo(
    () => (turns.data ? toTranscriptItems(turns.data, me.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the locale changes the items' words
    [turns.data, me.id, locale],
  )
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (focusHeading) headingRef.current?.focus()
  }, [focusHeading])

  const failed = detail.status === 'error' || turns.status === 'error'
  const closure = detail.data?.closure
  const heading = (
    <Heading
      ref={headingRef}
      tabIndex={-1}
      className="m-0 text-15 font-semibold text-ink focus-visible:outline-offset-4"
    >
      {t('history.caseHeading')} <span className="font-mono text-14">{shortCaseId(caseId)}</span>
    </Heading>
  )

  const back = (
    <Button
      variant="ghost"
      size="sm"
      icon={<ArrowLeft size={14} aria-hidden="true" />}
      onClick={onBack}
      className="self-start"
    >
      {t('history.back')}
    </Button>
  )

  if (failed) {
    const failure = describeCaseLoadFailure(detail.error ?? turns.error)
    return (
      <div className="flex flex-col gap-3">
        {back}
        {heading}
        <Callout
          tone="danger"
          title={failure.title}
          actions={
            <Button
              size="sm"
              onClick={() => {
                void detail.refetch()
                void turns.refetch()
              }}
            >
              {t('common:actions.retry')}
            </Button>
          }
        >
          {failure.description}
        </Callout>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {back}
      {heading}
      {detail.data && !failed ? (
        closure ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-13 font-semibold text-ink">
              <CloseReasonIcon reason={closure.reason} />
              {closeReasonLabel(closure.reason)}
            </span>
            <Fact
              icon="clock"
              text={formatDateTime(closure.closedAt, { withYear: false })}
              label={t('footer.closedAt')}
              tooltip={t('footer.closedAt')}
            />
            {closure.closedByName ? (
              <Fact
                icon="user"
                text={closure.closedByName}
                label={t('footer.closedBy')}
                tooltip={t('footer.closedBy')}
              />
            ) : null}
          </span>
        ) : (
          <Status {...caseLifecycleStatus(detail.data.case.status)} />
        )
      ) : null}
      {closure?.note ? (
        <p className="m-0 text-13 text-ink-2">{t('footer.note', { note: closure.note })}</p>
      ) : null}
      {turns.status === 'pending' || detail.status === 'pending' ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-10 w-1/2 self-end" />
        </div>
      ) : (
        <>
          {turns.data.olderCursor ? (
            <div className="flex flex-col items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                loading={older.isPending}
                onClick={() => older.mutate()}
              >
                {t('transcript.loadOlder')}
              </Button>
              {older.isError ? (
                <span className="text-12 text-danger-strong" role="alert">
                  {t('transcript.loadOlderFailed')}
                </span>
              ) : null}
            </div>
          ) : null}
          <ChatTranscript items={items} label={t('history.transcript')} />
        </>
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      {[0, 1].map((row) => (
        <Skeleton key={row} className="h-16 w-full" />
      ))}
    </div>
  )
}
