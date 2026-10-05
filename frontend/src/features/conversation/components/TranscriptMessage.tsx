import { Bot, CircleAlert, Clock, Pause, PhoneOff, Play, StickyNote } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import type { CallEventKind } from '../channels'
import { noticeLabel, type TranscriptItem } from '../model'
import { EmailCard } from './EmailCard'

export interface TranscriptMessageProps {
  item: TranscriptItem
  onRetry?: (clientMessageId: string) => void
}

const BUBBLE: Record<'customer' | 'own' | 'analyst' | 'assistant', string> = {
  customer: 'self-start border-border bg-surface text-ink',
  own: 'self-end border-ink bg-ink text-white',
  analyst: 'self-end border-ink-2 bg-ink-2 text-white',
  // Slice 19: the virtual assistant, on the bank's side in a pale blue bubble.
  assistant: 'self-end border-accent-border bg-assistant-bubble text-ink',
}

/**
 * One turn of the chat transcript (Workspace.dc.html): customer bubbles on the
 * left, the analyst's own on the right in ink, another analyst's in ink-2, the virtual
 * assistant's on the right in pale blue under its bot mark (slice 19);
 * the staff-only assignment banner centred in accent, notices as centred muted
 * notes. Bubbles take at most 70% of the column.
 */
export function TranscriptMessage({ item, onRetry }: TranscriptMessageProps) {
  if (item.variant === 'line') return <CallLine item={item} />
  if (item.variant === 'call-event') return <CallEvent item={item} />
  if (item.variant === 'note') return <NoteItem item={item} />
  if (item.variant === 'email') return <EmailCard item={item} />
  if (item.variant === 'routing') {
    return (
      <li className="flex justify-center">
        <p className="m-0 max-w-[90%] rounded-10 bg-accent-soft px-3 py-2 text-center text-13 whitespace-pre-line text-ink">
          <span className="sr-only">Nota interna: </span>
          {item.text}
        </p>
      </li>
    )
  }
  if (item.variant === 'notice') {
    return (
      <li className="flex justify-center">
        <p className="m-0 flex max-w-[80%] flex-col items-center gap-0.5 text-center text-12 text-muted">
          <span className="font-semibold">{noticeLabel(item)}</span>
          <span>{item.text}</span>
        </p>
      </li>
    )
  }

  const variant = item.variant as keyof typeof BUBBLE
  const alignEnd = variant !== 'customer'
  return (
    <li
      className={cn('flex flex-col gap-1', alignEnd ? 'items-end' : 'items-start')}
      aria-busy={item.delivery === 'sending' || undefined}
    >
      <div
        className={cn(
          'max-w-[70%] rounded-14 border px-3.5 py-2.5 text-15 leading-[1.45] break-words whitespace-pre-line',
          BUBBLE[variant],
          item.delivery === 'failed' && 'border-danger-border',
        )}
      >
        <span className="sr-only">{item.author}: </span>
        {item.text}
      </div>
      <MessageMeta item={item} onRetry={onRetry} />
    </li>
  )
}

function MessageMeta({ item, onRetry }: TranscriptMessageProps) {
  if (item.delivery === 'sending') {
    // Visual only: the transcript log announces the message itself once, and a
    // failure is announced by its alert; a transient "Enviando…" would be noise.
    return (
      <span className="flex items-center gap-1 text-12 text-muted" aria-hidden="true">
        <Clock size={12} aria-hidden="true" />
        Enviando…
      </span>
    )
  }
  if (item.delivery === 'failed') {
    return (
      <span
        className="flex items-center gap-1.5 text-12 font-medium text-danger-strong"
        role="alert"
      >
        <CircleAlert size={13} aria-hidden="true" />
        {item.error ?? 'No se envió'}
        {item.retryable && item.clientMessageId && onRetry ? (
          <>
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-accent underline-offset-2 hover:underline"
              onClick={() => onRetry(item.clientMessageId ?? '')}
            >
              Reintentar
            </button>
          </>
        ) : null}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-2 text-12 text-muted" aria-hidden="true">
      {item.variant === 'assistant' ? (
        <span className="inline-flex items-center gap-1 font-semibold text-ink-2">
          <Bot size={13} aria-hidden="true" />
          {item.author}
        </span>
      ) : (
        <span>{item.author}</span>
      )}
      <span className="inline-flex items-center gap-1">
        <Clock size={12} aria-hidden="true" />
        {formatTime(item.createdAt)}
      </span>
    </span>
  )
}

const EVENT_ICON: Record<CallEventKind, typeof Pause> = {
  hold: Pause,
  resume: Play,
  end: PhoneOff,
}

/**
 * A call transcript line (slice 12, canvas "llamada"): the time inside the call in mono,
 * the speaker's avatar and label ("Cliente", "Tú"), then what was said.
 */
function CallLine({ item }: { item: TranscriptItem }) {
  const customer = item.speaker === 'customer'
  return (
    <li className="flex items-start gap-3">
      <span className="w-11 shrink-0 pt-1.5 font-mono text-12 text-muted" aria-hidden="true">
        {item.time}
      </span>
      <Avatar
        name={item.author ?? ''}
        initials={item.initials}
        tone={customer ? 'neutral' : 'accent'}
        size="sm"
        decorative
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-13 font-semibold text-ink-2" aria-hidden="true">
          {item.author}
        </span>
        <p className="m-0 text-15 leading-[1.45] break-words whitespace-pre-line text-ink">
          <span className="sr-only">
            {item.author}, {item.time}:{' '}
          </span>
          {item.text}
        </p>
      </div>
    </li>
  )
}

/** A system line of a call: held, resumed or ended, with its glyph. */
function CallEvent({ item }: { item: TranscriptItem }) {
  const Icon = EVENT_ICON[item.event ?? 'end']
  return (
    <li className="flex items-center gap-3">
      <span className="w-11 shrink-0 font-mono text-12 text-muted" aria-hidden="true">
        {item.time}
      </span>
      <p className="m-0 inline-flex items-center gap-2 rounded-10 bg-panel px-3 py-1.5 text-13 text-ink-2">
        <Icon size={13} aria-hidden="true" />
        {item.text}
      </p>
    </li>
  )
}

/** A staff-only note: accent tint, "Nota interna" for screen readers, who wrote it and when. */
function NoteItem({ item }: { item: TranscriptItem }) {
  return (
    <li className="flex flex-col items-center gap-1">
      <p className="m-0 flex max-w-[90%] items-start gap-2 rounded-10 bg-accent-soft px-3 py-2 text-13 whitespace-pre-line text-ink">
        <StickyNote size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-strong" />
        <span>
          <span className="sr-only">Nota interna: </span>
          {item.text}
        </span>
      </p>
      <span className="flex items-center gap-2 text-12 text-muted" aria-hidden="true">
        <span>Nota interna</span>
        <span>{item.author}</span>
        <span className="inline-flex items-center gap-1">
          <Clock size={12} aria-hidden="true" />
          {formatTime(item.createdAt)}
        </span>
      </span>
    </li>
  )
}
