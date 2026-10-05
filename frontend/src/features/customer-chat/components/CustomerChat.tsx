import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button, Callout, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { assistantView } from '../assistant'
import { chatTurns } from '../channels'
import {
  chatLang,
  closedConversationNote,
  conversationStatusLine,
  customerChatCopy,
  inputPlaceholder,
  normalizeCustomerMessage,
  surveyState,
  toChatItems,
  visibleSuggestions,
  type ChatItem,
} from '../model'
import {
  useCustomerChatLive,
  useCustomerConversation,
  useRateConversation,
  useSendCustomerMessage,
  useSkippedRatings,
} from '../hooks'
import type { Language } from '../types'
import { AskPersonButton, AssistantTyping, ConfirmationCard, StepUpCard } from './AssistantControls'
import { ChatBubble } from './ChatBubble'
import { PastConversations } from './PastConversations'
import { RatedPill, RatingSurvey } from './RatingSurvey'

export interface CustomerChatProps {
  customerId: string
  /** Chips of this customer (from the picker list): openers or open-chat follow-ups. */
  suggestions: readonly string[]
  /** The customer's language: everything inside the phone frame speaks it. */
  language: Language
}

/**
 * The customer's chat, framed like the mobile app support screen
 * (AppSupportChat.dc.html): "Soporte" + who is attending, the past
 * conversations on demand, the current conversation, opener chips and the
 * input. After a close the input stays enabled: writing starts a new
 * conversation (contract §9.6). Live through `customer:<id>`. The copy follows
 * the customer's language (Spanish or Portuguese), like the notices the server
 * sends them.
 *
 * Slice 7: while the current conversation is closed and neither rated nor skipped,
 * the satisfaction survey takes the composer's place; once rated, a thanks pill
 * closes the transcript and the composer returns ("Ahora no" brings it back too).
 */
export function CustomerChat({ customerId, suggestions, language }: CustomerChatProps) {
  const copy = customerChatCopy(language)
  useCustomerChatLive(customerId)
  const chat = useCustomerConversation(customerId)
  const { send, retry } = useSendCustomerMessage(customerId)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Slice 12: call lines and emails have their own views; the chat shows messages and notices.
  const items = useMemo(() => (chat.data ? toChatItems(chatTurns(chat.data)) : []), [chat.data])
  const scrollRef = useScrollToEnd(items)
  const conversation = chat.data?.conversation ?? null
  // Slice 19: the assistant's typing pill, confirmation, second factor and "Hablar con una persona".
  const assistant = assistantView(conversation)
  const assistantCard = assistant.confirmation !== null || assistant.stepUp !== null
  const chips =
    chat.status === 'success' && !assistant.working && !assistantCard
      ? visibleSuggestions(suggestions, chat.data)
      : []
  const message = normalizeCustomerMessage(text)
  const { skipped, skip } = useSkippedRatings()
  const rate = useRateConversation(customerId)
  const survey = chat.status === 'success' ? surveyState(conversation, skipped) : 'none'
  const asking = survey === 'ask' && conversation !== null
  const closedNote = asking ? null : closedConversationNote(conversation, language)
  const visibleChips = asking ? [] : chips
  // The survey held the focus when it left (sent or skipped): hand it to the input.
  const focusInputNext = useRef(false)
  useEffect(() => {
    if (!asking && focusInputNext.current) {
      focusInputNext.current = false
      inputRef.current?.focus()
    }
  }, [asking])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!message) return
    send(message)
    setText('')
    // Keyboard users keep writing (the send button is never natively disabled,
    // so it never drops the focus to <body> either).
    inputRef.current?.focus()
  }

  return (
    <div
      lang={chatLang(language)}
      className="mx-auto flex h-full max-h-[844px] w-full max-w-[390px] flex-col overflow-hidden rounded-16 border border-app-line bg-app-canvas text-app-ink shadow-popover"
    >
      <header className="flex items-center gap-3 border-b border-app-line bg-white px-5 pt-[18px] pb-3">
        <span className="flex grow flex-col">
          <span className="text-16 font-semibold">{copy.support}</span>
          <span className="text-12 text-app-muted" aria-live="polite">
            {chat.status === 'success'
              ? conversationStatusLine(conversation, language, chat.data.turns)
              : copy.loading}
          </span>
          {assistant.canAskPerson ? (
            <AskPersonButton customerId={customerId} language={language} compact />
          ) : null}
        </span>
      </header>

      <div
        ref={scrollRef}
        className="flex min-h-0 grow scrollbar-thin flex-col gap-3 overflow-y-auto p-4"
      >
        {chat.status === 'pending' ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-10 w-1/2 self-end" />
          </div>
        ) : chat.status === 'error' ? (
          <Callout
            tone="danger"
            title={copy.loadErrorTitle}
            actions={
              <Button size="sm" loading={chat.isFetching} onClick={() => void chat.refetch()}>
                {copy.retry}
              </Button>
            }
          >
            {copy.loadErrorBody}
          </Callout>
        ) : (
          <>
            <PastConversations customerId={customerId} cache={chat.data} language={language} />
            {/* The log mounts with the history already in it, so only messages
              added afterwards are announced (ARCHITECTURE.md §11). Past
              conversations stay outside it. */}
            <div role="log" aria-label={copy.logLabel} aria-relevant="additions">
              <ol aria-label={copy.messagesLabel} className="m-0 flex list-none flex-col gap-3 p-0">
                {items.length === 0 ? (
                  <li className="self-start rounded-[16px_16px_16px_4px] bg-white px-3.5 py-2.5 text-15 leading-[1.45]">
                    {copy.greeting}
                  </li>
                ) : null}
                {items.map((item) => (
                  <ChatBubble key={item.key} item={item} copy={copy} onRetry={retry} />
                ))}
              </ol>
            </div>
          </>
        )}
        {/* Mounted with the chat (empty while idle), so "escribiendo…" is announced. */}
        <output className="flex flex-col">
          {assistant.working ? <AssistantTyping language={language} /> : null}
        </output>
        {assistant.confirmation ? (
          <ConfirmationCard
            key={assistant.confirmation.token}
            customerId={customerId}
            confirmation={assistant.confirmation}
            language={language}
          />
        ) : assistant.stepUp && conversation ? (
          <StepUpCard
            key={conversation.caseId}
            customerId={customerId}
            stepUp={assistant.stepUp}
            language={language}
          />
        ) : null}
        {/* <output> is a polite status region mounted with the chat, so the thanks is
          announced when it appears. */}
        <output className="flex flex-col">
          {survey === 'rated' && conversation?.rating ? (
            <RatedPill rating={conversation.rating} language={language} />
          ) : null}
        </output>
        {visibleChips.length > 0 ? (
          <fieldset className="m-0 flex min-w-0 flex-col items-start gap-2 border-0 p-0">
            <legend className="sr-only">{copy.suggestionsLabel}</legend>
            {visibleChips.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="min-h-11 cursor-pointer rounded-full border border-app-chip-line bg-white px-4 text-left text-15 font-semibold text-app-brand hover:border-app-brand"
                onClick={() => {
                  setText(suggestion)
                  inputRef.current?.focus()
                }}
              >
                {suggestion}
              </button>
            ))}
          </fieldset>
        ) : null}
      </div>

      {asking ? (
        <RatingSurvey
          key={conversation.caseId}
          caseId={conversation.caseId}
          agentName={conversation.agentName}
          language={language}
          sending={rate.isPending}
          error={rate.isError ? rate.error : null}
          onSend={(input) => {
            focusInputNext.current = true
            rate.mutate(input)
          }}
          onSkip={(caseId) => {
            focusInputNext.current = true
            skip(caseId)
            rate.reset()
          }}
        />
      ) : null}
      {closedNote ? (
        <p className="m-0 border-t border-app-line bg-white px-5 pt-3 text-center text-12 text-app-muted">
          {closedNote}
        </p>
      ) : null}
      {asking ? null : (
        <form
          onSubmit={submit}
          className={cn(
            'flex items-center gap-2 bg-white px-4 pt-3 pb-[26px]',
            !closedNote && 'border-t border-app-line',
          )}
        >
          <label htmlFor="customer-message" className="sr-only">
            {copy.inputLabel}
          </label>
          <input
            ref={inputRef}
            id="customer-message"
            type="text"
            autoComplete="off"
            placeholder={inputPlaceholder(conversation, language)}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-11 grow rounded-full border-0 bg-app-canvas px-4 text-15 text-app-ink placeholder:text-app-muted"
          />
          <button
            type="submit"
            aria-label={copy.send}
            aria-disabled={!message || undefined}
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-app-brand text-white hover:bg-app-brand-strong aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>
      )}
    </div>
  )
}

/** Keeps the newest message in view when it arrives (the customer reads from the bottom). */
function useScrollToEnd(items: readonly ChatItem[]) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (element) element.scrollTop = element.scrollHeight
  }, [items])
  return ref
}
