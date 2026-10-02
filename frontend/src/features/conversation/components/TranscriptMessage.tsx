import { CircleAlert, Clock } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import { noticeLabel, type TranscriptItem } from '../model'

export interface TranscriptMessageProps {
  item: TranscriptItem
  onRetry?: (clientMessageId: string) => void
}

const BUBBLE: Record<'customer' | 'own' | 'analyst' | 'bot', string> = {
  customer: 'self-start border-border bg-surface text-ink',
  own: 'self-end border-ink bg-ink text-white',
  analyst: 'self-end border-ink-2 bg-ink-2 text-white',
  bot: 'self-end border-accent-border bg-accent-soft text-ink',
}

/**
 * One turn of the chat transcript (Workspace.dc.html): customer bubbles on the
 * left, the analyst's own on the right in ink, bots on the right tinted; routing
 * turns as the centred accent banner, notices as centred muted notes.
 */
export function TranscriptMessage({ item, onRetry }: TranscriptMessageProps) {
  if (item.variant === 'routing') {
    return (
      <li className="flex justify-center">
        <p className="m-0 max-w-[90%] rounded-10 bg-accent-soft px-3 py-2 text-center text-13 whitespace-pre-line text-ink">
          <span className="sr-only">Cómo llegó el caso: </span>
          {item.text}
        </p>
      </li>
    )
  }
  if (item.variant === 'notice') {
    return (
      <li className="flex justify-center">
        <p className="m-0 max-w-[80%] text-center text-12 text-muted">
          <span className="font-semibold">{noticeLabel(item)}</span> · {item.text}
        </p>
      </li>
    )
  }

  const alignEnd = item.variant !== 'customer'
  return (
    <li
      className={cn('flex flex-col gap-1', alignEnd ? 'items-end' : 'items-start')}
      aria-busy={item.delivery === 'sending' || undefined}
    >
      <div
        className={cn(
          'max-w-[72%] rounded-14 border px-3.5 py-2.5 text-15 leading-[1.45] break-words whitespace-pre-line',
          BUBBLE[item.variant],
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
            <span aria-hidden="true">·</span>
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
    <span className="text-12 text-muted" aria-hidden="true">
      {item.author} · {formatTime(item.createdAt)}
    </span>
  )
}
