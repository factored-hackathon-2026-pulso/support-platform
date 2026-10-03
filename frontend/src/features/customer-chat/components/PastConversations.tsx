import { useEffect, useRef, useState, type Ref } from 'react'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import { Button, Skeleton } from '@/components/ui'
import {
  customerChatCopy,
  endedSummary,
  hiddenPastCount,
  pastBlockTitle,
  pastBlocks,
  pastConversationsButton,
  toChatItems,
  type CustomerChatCopy,
} from '../model'
import { usePastConversation, usePastConversations } from '../hooks'
import type {
  CustomerChatCache,
  CustomerConversationSummary,
  CustomerTurn,
  Language,
} from '../types'
import { ChatBubble } from './ChatBubble'

export interface PastConversationsProps {
  customerId: string
  cache: CustomerChatCache
  language: Language
}

/**
 * Past conversations above the current one (contract §9.6): "Ver conversaciones
 * anteriores (n)" loads the closed ones as collapsed blocks, oldest at the top;
 * expanding a block loads its messages, read-only. A conversation that ended
 * while the simulator was open is already a block (expanded) right above the
 * current conversation.
 *
 * Focus: the button goes away once the list loads, so the focus moves to the
 * first loaded block (or the section) instead of falling to <body>.
 */
export function PastConversations({ customerId, cache, language }: PastConversationsProps) {
  const copy = customerChatCopy(language)
  const [requested, setRequested] = useState(false)
  const hidden = hiddenPastCount(cache)
  const list = usePastConversations(customerId, requested)
  const label = pastConversationsButton(hidden, language)
  const blocks = list.data ? pastBlocks(list.data.items, cache.ended) : []
  const ended = cache.ended.map((past) => ({ summary: endedSummary(past), turns: past.turns }))
  const any = blocks.length > 0 || ended.length > 0

  const sectionRef = useRef<HTMLElement>(null)
  const firstBlockRef = useRef<HTMLButtonElement>(null)
  /** Set by the button: once its list arrives, the focus moves into the blocks. */
  const focusOnLoad = useRef(false)
  const loaded = list.data !== undefined
  useEffect(() => {
    if (!loaded || !focusOnLoad.current) return
    focusOnLoad.current = false
    ;(firstBlockRef.current ?? sectionRef.current)?.focus()
  }, [loaded])

  return (
    <>
      {label && !list.data ? (
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => {
              focusOnLoad.current = true
              setRequested(true)
            }}
            aria-busy={list.isFetching || undefined}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-app-chip-line bg-white px-3.5 text-13 font-semibold text-app-brand hover:border-app-brand"
          >
            <History size={14} aria-hidden="true" />
            {list.isFetching ? copy.loading : label}
          </button>
          {list.isError ? (
            <span role="alert" className="text-12 text-danger-strong">
              {copy.pastLoadError}{' '}
              <Button variant="ghost" size="sm" onClick={() => void list.refetch()}>
                {copy.retry}
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}
      {any ? (
        <section
          ref={sectionRef}
          tabIndex={-1}
          aria-label={copy.pastSectionLabel}
          className="flex flex-col focus-visible:outline-offset-2"
        >
          <ol className="m-0 flex list-none flex-col p-0">
            {blocks.map((summary, index) => (
              <PastBlock
                key={summary.caseId}
                customerId={customerId}
                summary={summary}
                language={language}
                copy={copy}
                toggleRef={index === 0 ? firstBlockRef : undefined}
              />
            ))}
            {ended.map(({ summary, turns }) => (
              <PastBlock
                key={summary.caseId}
                customerId={customerId}
                summary={summary}
                language={language}
                copy={copy}
                turns={turns}
                defaultExpanded
              />
            ))}
          </ol>
          <p className="m-0 flex items-center gap-2 py-2 text-11 font-semibold tracking-label text-app-muted uppercase">
            <span aria-hidden="true" className="h-px grow bg-app-line" />
            {copy.currentConversation}
            <span aria-hidden="true" className="h-px grow bg-app-line" />
          </p>
        </section>
      ) : null}
    </>
  )
}

interface PastBlockProps {
  customerId: string
  summary: CustomerConversationSummary
  language: Language
  copy: CustomerChatCopy
  /** The first loaded block's toggle: where the focus lands after "Ver conversaciones anteriores". */
  toggleRef?: Ref<HTMLButtonElement>
  /** Already known (it ended here): no request needed. */
  turns?: CustomerTurn[]
  defaultExpanded?: boolean
}

function PastBlock({
  customerId,
  summary,
  language,
  copy,
  toggleRef,
  turns,
  defaultExpanded = false,
}: PastBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const detail = usePastConversation(customerId, summary.caseId, expanded && !turns)
  const shown = turns ?? detail.data?.turns
  const items = shown ? toChatItems({ turns: shown, pending: [] }) : []
  const panelId = `past-${summary.caseId}`
  const title = pastBlockTitle(summary, language)

  return (
    <li className="flex flex-col gap-2 border-b border-app-line py-3">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((open) => !open)}
        className="flex cursor-pointer items-start gap-2 border-0 bg-transparent p-0 text-left text-app-ink"
      >
        {expanded ? (
          <ChevronDown size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-app-muted" />
        ) : (
          <ChevronRight size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-app-muted" />
        )}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-13 font-semibold">{title}</span>
          {summary.preview ? (
            <span className="truncate text-12 text-app-muted">{summary.preview}</span>
          ) : null}
        </span>
      </button>
      {expanded ? (
        <div id={panelId}>
          {shown ? (
            <ol aria-label={title} className="m-0 flex list-none flex-col gap-3 p-0">
              {items.map((item) => (
                <ChatBubble key={item.key} item={item} copy={copy} />
              ))}
            </ol>
          ) : detail.isError ? (
            <p role="alert" className="m-0 text-12 text-danger-strong">
              {copy.pastBlockLoadError}{' '}
              <Button variant="ghost" size="sm" onClick={() => void detail.refetch()}>
                {copy.retry}
              </Button>
            </p>
          ) : (
            <div aria-busy="true" className="flex flex-col gap-2">
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-9 w-1/2 self-end" />
            </div>
          )}
        </div>
      ) : null}
    </li>
  )
}
