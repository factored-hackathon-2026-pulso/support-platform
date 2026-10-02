import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useCurrentUser } from '@/app/session'
import { Button, Callout, Skeleton } from '@/components/ui'
import {
  conversationLayout,
  describeCaseLoadFailure,
  toTranscriptItems,
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
import { CallBar } from './CallBar'
import { CallTranscript } from './CallTranscript'
import { CaseHeader } from './CaseHeader'
import { ChatTranscript } from './ChatTranscript'
import { CloseCaseDialog } from './CloseCaseDialog'
import { Composer } from './Composer'
import { EmailThread } from './EmailThread'

export interface ConversationPaneProps {
  caseId: string
  /** Called after "Cerrar caso" succeeds (the Workspace selects the next case). */
  onClosed?(caseId: string): void
  /**
   * Move the keyboard focus to the case heading once it renders (the Workspace
   * asks for it after a programmatic switch: next case after closing, "Ver caso").
   * `onFocused` is called once it moved, so the request is not repeated.
   */
  focusOnLoad?: boolean
  onFocused?(): void
}

/**
 * Centre column of the Workspace for one case: header, transcript (chat, call or
 * e-mail layout), composer and the close dialog. Live through `case:<id>`.
 */
export function ConversationPane(props: ConversationPaneProps) {
  // A fresh body per case: drafts, scroll and dialogs never leak between cases.
  return <ConversationBody key={props.caseId} {...props} />
}

function ConversationBody({ caseId, onClosed, focusOnLoad, onFocused }: ConversationPaneProps) {
  const me = useCurrentUser()
  useConversationLive(caseId)
  const detail = useCaseDetail(caseId)
  const turns = useCaseTurns(caseId, detail.data?.case.lastSequence)
  useMarkRead(detail.data?.case, me.id)

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
      headingRef={setFocusTarget}
    />
  )
}

interface LoadedConversationProps {
  detail: CaseDetail
  turns: ReturnType<typeof useCaseTurns>
  meId: string
  onClosed?(caseId: string): void
  headingRef: (element: HTMLElement | null) => void
}

function LoadedConversation({
  detail,
  turns,
  meId,
  onClosed,
  headingRef,
}: LoadedConversationProps) {
  const { case: summary, capabilities } = detail
  const layout = conversationLayout(summary.channel)
  const [closing, setClosing] = useState(false)
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
      <CaseHeader detail={detail} headingRef={headingRef} onRequestClose={() => setClosing(true)} />
      {layout === 'call' ? <CallBar detail={detail} /> : null}
      <TranscriptArea
        caseId={summary.id}
        layout={layout}
        turns={turns}
        items={items}
        startedAt={summary.liveSince}
        onRetry={retry}
      />
      <div className="shrink-0 border-t border-border px-6 pt-3 pb-[18px]">
        <Composer
          blockedReason={
            capabilities.canReply ? null : (capabilities.replyBlockedReason ?? 'closed')
          }
          onSend={send}
        />
      </div>
      <CloseCaseDialog
        summary={summary}
        open={closing}
        onOpenChange={setClosing}
        onClosed={onClosed}
      />
    </section>
  )
}

interface TranscriptAreaProps {
  caseId: string
  layout: ReturnType<typeof conversationLayout>
  turns: ReturnType<typeof useCaseTurns>
  items: TranscriptItem[]
  startedAt: string | null
  onRetry: (clientMessageId: string) => void
}

function TranscriptArea({ caseId, layout, turns, items, startedAt, onRetry }: TranscriptAreaProps) {
  const scrollRef = useStickToBottom(items, turns.data)
  const older = useLoadOlderTurns(caseId)
  const olderBusy = useOlderPageBusy(older.isPending, items[0]?.key ?? '')
  const banners = layout === 'chat' ? [] : items.filter((item) => item.variant === 'routing')

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
        {layout === 'call' ? (
          <CallTranscript items={items} startedAt={startedAt} />
        ) : layout === 'email' ? (
          <EmailThread items={items} />
        ) : (
          <ChatTranscript items={items} onRetry={onRetry} />
        )}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-2.5 overflow-y-auto px-6 py-[18px]"
    >
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
      {banners.map((banner) => (
        <p
          key={banner.key}
          className="m-0 max-w-[90%] self-center rounded-10 bg-accent-soft px-3 py-2 text-center text-13 text-ink"
        >
          {banner.text}
        </p>
      ))}
      {body}
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
