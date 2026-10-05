import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronRight, Mail, Send } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatDateTime, getInitials } from '@/lib/format'
import {
  MAX_EMAIL_SUBJECT,
  customerMailCopy,
  customerMailItems,
  customerReplySubject,
  customerThreadSubject,
  describeCustomerEmailFailure,
  mailComposeMode,
  validateCustomerEmail,
  type MailItem,
} from '../channels'
import { useCustomerConversation, useSendCustomerEmail, useSkippedRatings } from '../hooks'
import { isAssistantActive } from '../assistant'
import { MAX_CUSTOMER_MESSAGE_LENGTH, chatLang, surveyState } from '../model'
import type { Language } from '../types'
import { AskPersonButton } from './AssistantControls'
import { ConversationSurvey } from './ConversationSurvey'

export interface CustomerMailViewProps {
  customerId: string
  customerName: string
  language: Language
}

/**
 * The customer's email (slice 12, Main.dc.html "correo"): the thread of the current
 * conversation (older emails as one line, the newest open, the bank's unanswered replies
 * "Nuevo") and the composer: "Escribe tu correo" with Asunto + Mensaje, or "Responder" in the
 * thread. After the case closes, the satisfaction survey comes first.
 */
export function CustomerMailView({ customerId, customerName, language }: CustomerMailViewProps) {
  const copy = customerMailCopy(language)
  const ids = useId()
  const chat = useCustomerConversation(customerId)
  const send = useSendCustomerEmail(customerId, language)
  const { skipped, skip } = useSkippedRatings()
  const turns = chat.data?.turns ?? []
  const conversation = chat.data?.conversation ?? null
  const items = customerMailItems(turns, language)
  const subject = customerThreadSubject(turns)
  const mode = mailComposeMode(conversation, subject)
  const asking = surveyState(conversation, skipped) === 'ask'
  const [draftSubject, setDraftSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const key = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [items.length])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (send.isPending) return
    const invalid = validateCustomerEmail(mode, draftSubject, body, language)
    setError(invalid)
    if (invalid) return
    key.current ??= crypto.randomUUID()
    send.mutate(
      {
        subject: mode === 'new' ? draftSubject.trim() : customerReplySubject(subject ?? ''),
        body: body.trim(),
        clientMessageId: key.current,
      },
      {
        onSuccess: () => {
          key.current = null
          setBody('')
          setDraftSubject('')
        },
      },
    )
  }

  function edited() {
    key.current = null
    setError(null)
    if (send.isError) send.reset()
  }

  const heading = subject ?? copy.newHeading
  const message =
    error ?? (send.isError ? describeCustomerEmailFailure(send.error, language) : null)

  return (
    <section
      aria-labelledby={`${ids}-heading`}
      lang={chatLang(language)}
      className="mx-auto flex h-full max-h-[844px] w-full max-w-[760px] flex-col overflow-hidden rounded-16 border border-app-line bg-white text-app-ink shadow-popover"
    >
      <header className="flex shrink-0 flex-col gap-1 border-b border-app-line px-5 py-4">
        <span className="inline-flex items-center gap-1.5 text-12 font-semibold text-app-muted">
          <Mail size={13} aria-hidden="true" />
          {copy.support}
        </span>
        <h2 id={`${ids}-heading`} className="m-0 text-18 font-semibold">
          {heading}
        </h2>
      </header>
      <div
        ref={scrollRef}
        className="flex min-h-0 grow scrollbar-thin flex-col gap-3 overflow-y-auto bg-app-canvas p-4"
      >
        {items.length === 0 ? <p className="m-0 text-14 text-app-muted">{copy.empty}</p> : null}
        <ol aria-label={copy.threadLabel} className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((item) =>
            item.kind === 'notice' ? (
              <li key={item.key} className="self-center px-4 text-center text-12 text-app-muted">
                {item.body}
              </li>
            ) : (
              <MailRow
                key={item.key}
                item={item}
                customerName={customerName}
                newMark={copy.newMark}
              />
            ),
          )}
        </ol>
      </div>
      {asking ? (
        <div className="border-t border-app-line">
          <ConversationSurvey
            customerId={customerId}
            conversation={conversation}
            language={language}
            skipped={skipped}
            onSkip={skip}
          />
        </div>
      ) : (
        <form
          onSubmit={submit}
          aria-label={mode === 'new' ? copy.composeNew : copy.composeReply}
          className="flex shrink-0 flex-col gap-2.5 border-t border-app-line px-5 pt-3 pb-5"
        >
          <span className="flex flex-wrap items-baseline gap-x-2 text-14 font-semibold">
            {mode === 'new' ? copy.composeNew : copy.composeReply}
            {mode === 'reply' && subject ? (
              <span className="text-13 font-normal text-app-muted">
                {customerReplySubject(subject)}
              </span>
            ) : null}
          </span>
          {mode === 'new' ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-subject`} className="text-13 font-semibold">
                {copy.subjectLabel}
              </label>
              <input
                id={`${ids}-subject`}
                type="text"
                maxLength={MAX_EMAIL_SUBJECT}
                value={draftSubject}
                onChange={(event) => {
                  setDraftSubject(event.target.value)
                  edited()
                }}
                className="min-h-10 rounded-10 border border-app-chip-line px-3 text-15"
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-body`} className="text-13 font-semibold">
              {copy.bodyLabel}
            </label>
            <textarea
              id={`${ids}-body`}
              rows={mode === 'new' ? 5 : 3}
              maxLength={MAX_CUSTOMER_MESSAGE_LENGTH}
              placeholder={mode === 'new' ? copy.newPlaceholder : copy.replyPlaceholder}
              value={body}
              onChange={(event) => {
                setBody(event.target.value)
                edited()
              }}
              className="resize-none rounded-10 border border-app-chip-line px-3 py-2.5 text-15 placeholder:text-app-muted"
            />
          </div>
          {message ? (
            <p role="alert" className="m-0 text-13 text-danger">
              {message}
            </p>
          ) : null}
          {send.isError && isAssistantActive(send.error) ? (
            <AskPersonButton
              customerId={customerId}
              language={language}
              compact
              onDone={() => send.reset()}
            />
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span className="text-12 text-app-muted">{copy.replyHint}</span>
            <button
              type="submit"
              aria-busy={send.isPending || undefined}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-0 bg-app-brand px-5 text-15 font-semibold text-white hover:bg-app-brand-strong"
            >
              {copy.send}
              <Send size={15} aria-hidden="true" />
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function MailRow({
  item,
  customerName,
  newMark,
}: {
  item: MailItem
  customerName: string
  newMark: string
}) {
  const [open, setOpen] = useState(item.latest || item.isNew)
  const bodyId = useId()
  return (
    <li
      className={cn(
        'rounded-12 border bg-white',
        item.isNew ? 'border-app-brand' : 'border-app-line',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-12 border-0 bg-transparent px-4 py-3 text-left"
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full text-12 font-semibold',
            item.mine ? 'bg-app-rate-good text-app-rate-ink' : 'bg-accent-soft text-accent-strong',
          )}
        >
          {getInitials(item.mine ? customerName : (item.from.split(',')[0] ?? item.from))}
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-14 font-semibold text-app-ink">{item.from}</span>
            <span className="flex shrink-0 items-center gap-2 text-12 text-app-muted">
              {item.isNew ? (
                <span className="inline-flex items-center gap-1 font-semibold text-app-brand">
                  <span aria-hidden="true" className="size-2 rounded-full bg-app-brand" />
                  {newMark}
                </span>
              ) : null}
              {formatDateTime(item.createdAt, { withYear: false })}
            </span>
          </span>
          {open ? null : (
            <span className="truncate text-13 text-app-muted">
              {item.body.replace(/\s+/g, ' ')}
            </span>
          )}
        </span>
        {open ? (
          <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-app-muted" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-app-muted" />
        )}
      </button>
      {open ? (
        <div
          id={bodyId}
          className="border-t border-app-line px-4 py-3 text-15 leading-[1.5] break-words whitespace-pre-line"
        >
          {item.body}
        </div>
      ) : null}
    </li>
  )
}
