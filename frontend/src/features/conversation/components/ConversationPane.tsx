import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useCurrentUser } from '@/app/session'
import { Button, Callout, Skeleton, useToastClearance } from '@/components/ui'
import {
  describeCaseLoadFailure,
  toTranscriptItems,
  type ConversationMode,
  type TranscriptItem,
} from '../model'
import {
  useCaseDetail,
  useCaseTurns,
  useConversationLive,
  useLoadOlderTurns,
  useMarkRead,
  useSendMessage,
} from '../hooks'
import type { CaseDetail, TranscriptCache } from '../types'
import { ArrivalNote } from './ArrivalNote'
import { CaseHeader } from './CaseHeader'
import { ChatTranscript } from './ChatTranscript'
import { CloseCaseDialog } from './CloseCaseDialog'
import { Composer } from './Composer'
import { ReadOnlyFooter } from './ReadOnlyFooter'
import { UnsentDraft } from './UnsentDraft'

export interface ConversationPaneProps {
  caseId: string
  /** Called after "Cerrar caso" succeeds (the Workspace selects the next case). */
  onClosed?(caseId: string): void
  /** "Casos anteriores (n)" in the header (the Workspace opens the history sheet). */
  onOpenHistory?(): void
  /**
   * Move the keyboard focus to the case heading once it renders (the Workspace
   * asks for it after a programmatic switch: next case after closing, "Ver caso").
   * `onFocused` is called once it moved, so the request is not repeated.
   */
  focusOnLoad?: boolean
  onFocused?(): void
  /**
   * `workspace` (default): the analyst's pane (composer for the assignee, read
   * cursor, "Cerrar caso"). `supervision` (slice 3 §8.3): read-only for
   * everyone, even an assignee who also holds the supervisor role: no composer,
   * no read cursor, no "Cerrar caso"; the supervision arrival line and footer.
   */
  mode?: ConversationMode
  /** Rendered in the header before "Datos de ejemplo" (the supervisor's "Asignar" / "Reasignar"). */
  headerActions?: ReactNode
}

/**
 * The conversation column for one case (it takes the whole width next to the
 * Workspace list, or the whole supervisor case view): header, "Cómo llegó a ti",
 * the chat transcript, the composer (or the read-only footer) and the close
 * dialog. Live through `case:<id>`.
 */
export function ConversationPane(props: ConversationPaneProps) {
  // A fresh body per case: drafts, scroll and dialogs never leak between cases.
  return <ConversationBody key={props.caseId} {...props} />
}

function ConversationBody({
  caseId,
  onClosed,
  onOpenHistory,
  focusOnLoad,
  onFocused,
  mode = 'workspace',
  headerActions,
}: ConversationPaneProps) {
  const me = useCurrentUser()
  useConversationLive(caseId)
  const detail = useCaseDetail(caseId)
  const turns = useCaseTurns(caseId, detail.data?.case.lastSequence)
  useMarkRead(detail.data?.case, me.id, mode === 'workspace')

  // The heading (or the error section) once it is on screen.
  const focusTarget = useRef<HTMLElement | null>(null)
  const setFocusTarget = useCallback((element: HTMLElement | null) => {
    focusTarget.current = element
  }, [])
  useEffect(() => {
    if (!focusOnLoad || !focusTarget.current) return
    focusTarget.current.focus()
    onFocused?.()
  }, [focusOnLoad, onFocused, detail.status])

  if (detail.status === 'pending') return <ConversationSkeleton />
  if (detail.status === 'error') {
    const failure = describeCaseLoadFailure(detail.error)
    return (
      <section
        ref={setFocusTarget}
        tabIndex={-1}
        aria-label="Conversación"
        className="flex h-full grow flex-col justify-center p-6"
      >
        <Callout
          tone="danger"
          title={failure.title}
          actions={
            <Button size="sm" loading={detail.isFetching} onClick={() => void detail.refetch()}>
              Reintentar
            </Button>
          }
        >
          {failure.description}
        </Callout>
      </section>
    )
  }
  return (
    <LoadedConversation
      detail={detail.data}
      turns={turns}
      meId={me.id}
      onClosed={onClosed}
      onOpenHistory={onOpenHistory}
      headingRef={setFocusTarget}
      mode={mode}
      headerActions={headerActions}
    />
  )
}

interface LoadedConversationProps {
  detail: CaseDetail
  turns: ReturnType<typeof useCaseTurns>
  meId: string
  onClosed?(caseId: string): void
  onOpenHistory?(): void
  headingRef: (element: HTMLElement | null) => void
  mode: ConversationMode
  headerActions?: ReactNode
}

function LoadedConversation({
  detail,
  turns,
  meId,
  onClosed,
  onOpenHistory,
  headingRef,
  mode,
  headerActions,
}: LoadedConversationProps) {
  const { case: summary, capabilities } = detail
  const supervision = mode === 'supervision'
  const canReply = capabilities.canReply && !supervision
  const [closing, setClosing] = useState(false)
  // Owned here, not by the composer: when the viewer loses the case (supervision
  // reassigned it, or it closed) the composer goes away but the text stays.
  const [draft, setDraft] = useState('')
  const toastClearance = useToastClearance<HTMLDivElement>()
  const { send, retry } = useSendMessage(summary.id)
  const items = useMemo(
    () => (turns.data ? toTranscriptItems(turns.data, meId) : []),
    [turns.data, meId],
  )

  return (
    <section
      aria-label={`Conversación con ${summary.customer.displayName}`}
      className="flex h-full min-h-0 grow flex-col bg-canvas"
    >
      <CaseHeader
        detail={detail}
        headingRef={headingRef}
        onRequestClose={() => setClosing(true)}
        onOpenHistory={onOpenHistory}
        actions={headerActions}
        hideClose={supervision}
      />
      <ArrivalNote detail={detail} meId={meId} mode={mode} />
      <TranscriptArea caseId={summary.id} turns={turns} items={items} onRetry={retry} />
      {/* Toasts rise above the composer so they never cover "Enviar". */}
      <div ref={toastClearance} className="shrink-0 border-t border-border px-6 pt-3 pb-[18px]">
        <div className="mx-auto w-full max-w-[880px]">
          {canReply ? (
            <Composer value={draft} onChange={setDraft} onSend={send} />
          ) : (
            <div className="flex flex-col gap-2.5">
              {!supervision && draft.trim() ? (
                <UnsentDraft text={draft} onDiscard={() => setDraft('')} />
              ) : null}
              <ReadOnlyFooter detail={detail} meId={meId} mode={mode} />
            </div>
          )}
        </div>
      </div>
      {supervision ? null : (
        <CloseCaseDialog
          summary={summary}
          open={closing}
          onOpenChange={setClosing}
          onClosed={onClosed}
        />
      )}
    </section>
  )
}

interface TranscriptAreaProps {
  caseId: string
  turns: ReturnType<typeof useCaseTurns>
  items: TranscriptItem[]
  onRetry: (clientMessageId: string) => void
}

function TranscriptArea({ caseId, turns, items, onRetry }: TranscriptAreaProps) {
  const scrollRef = useStickToBottom(items, turns.data)
  const older = useLoadOlderTurns(caseId)
  const olderBusy = useOlderPageBusy(older.isPending, items[0]?.key ?? '')

  let body
  if (turns.status === 'pending') {
    body = <TranscriptSkeleton />
  } else if (turns.status === 'error') {
    body = (
      <Callout
        tone="danger"
        title="No pudimos cargar los mensajes"
        actions={
          <Button size="sm" loading={turns.isFetching} onClick={() => void turns.refetch()}>
            Reintentar
          </Button>
        }
      >
        Revisa tu conexión e inténtalo de nuevo.
      </Callout>
    )
  } else {
    // The log mounts once the first page is in, with that history already
    // inside, so only turns added afterwards are announced (ARCHITECTURE.md §11).
    // While an older page is merged it is busy: history is not news.
    body = (
      <div
        role="log"
        aria-label="Conversación del caso"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={olderBusy || undefined}
        className="flex flex-col gap-2.5"
      >
        <ChatTranscript items={items} onRetry={onRetry} />
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 scrollbar-thin overflow-y-auto px-6 py-[18px]"
    >
      {/* Readable width on a wide screen: the column fills the space, the text does not. */}
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-2.5">
        {turns.data?.olderCursor ? (
          <div className="flex flex-col items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              loading={older.isPending}
              onClick={() => older.mutate()}
            >
              Cargar mensajes anteriores
            </Button>
            {older.isError ? (
              <span className="text-12 text-danger-strong" role="alert">
                No pudimos cargar los mensajes anteriores. Inténtalo de nuevo.
              </span>
            ) : null}
          </div>
        ) : null}
        {body}
      </div>
    </div>
  )
}

/**
 * `aria-busy` for the transcript log while "Cargar mensajes anteriores" runs.
 * It turns off a frame **after** the commit that put the older turns in the DOM
 * (or the request ended without them), so the insertion always happens while
 * the log is busy and the history is not read out.
 */
function useOlderPageBusy(loading: boolean, firstKey: string): boolean {
  const [busy, setBusy] = useState(false)
  if (loading && !busy) setBusy(true)
  useEffect(() => {
    if (loading) return
    const frame = requestAnimationFrame(() => setBusy(false))
    return () => cancelAnimationFrame(frame)
  }, [loading, firstKey])
  return busy || loading
}

/**
 * Keeps the transcript scrolled to the newest message when the analyst is
 * already at the bottom (or on first load), and keeps the reading position when
 * older messages are added on top.
 */
function useStickToBottom(items: readonly TranscriptItem[], cache: TranscriptCache | undefined) {
  const ref = useRef<HTMLDivElement>(null)
  const snapshot = useRef({ firstKey: '', height: 0, atBottom: true })
  const firstKey = items[0]?.key ?? ''

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const previous = snapshot.current
    if (previous.firstKey && firstKey !== previous.firstKey && !previous.atBottom) {
      // Older page prepended: keep the same messages under the eyes.
      element.scrollTop += element.scrollHeight - previous.height
    } else if (previous.atBottom) {
      element.scrollTop = element.scrollHeight
    }
    snapshot.current = { firstKey, height: element.scrollHeight, atBottom: isAtBottom(element) }
  }, [items, firstKey, cache])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const onScroll = () => {
      snapshot.current = {
        ...snapshot.current,
        height: element.scrollHeight,
        atBottom: isAtBottom(element),
      }
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [])

  return ref
}

function isAtBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 48
}

function TranscriptSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-10 w-1/2 self-end" />
      <Skeleton className="h-14 w-3/5" />
    </div>
  )
}

function ConversationSkeleton() {
  return (
    <section
      aria-label="Cargando la conversación"
      aria-busy="true"
      className="flex h-full grow flex-col"
    >
      <div className="flex flex-col gap-2 border-b border-border px-6 py-3.5">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="flex-1 p-6">
        <TranscriptSkeleton />
      </div>
    </section>
  )
}
