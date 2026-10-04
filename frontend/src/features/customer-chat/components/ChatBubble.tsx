import { CircleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import type { ChatItem, CustomerChatCopy } from '../model'

/**
 * One message of the customer's chat: their own on the right in brand green,
 * the analyst's on the left with "{Nombre}, de LATAM Bank", platform notices
 * centred. `onRetry` is absent in read-only past conversations. `copy` is the
 * customer's language.
 */
export function ChatBubble({
  item,
  copy,
  onRetry,
}: {
  item: ChatItem
  copy: Pick<CustomerChatCopy, 'you' | 'sending' | 'notSent' | 'retry'>
  onRetry?: (id: string) => void
}) {
  if (item.side === 'notice') {
    return <li className="self-center px-4 text-center text-12 text-app-muted">{item.text}</li>
  }
  const mine = item.side === 'customer'
  return (
    <li
      className={cn('flex max-w-[86%] flex-col gap-1', mine ? 'items-end self-end' : 'self-start')}
    >
      {item.author ? <span className="text-12 text-app-muted">{item.author}</span> : null}
      <div
        className={cn(
          'px-3.5 py-2.5 text-15 leading-[1.45] break-words whitespace-pre-line',
          mine
            ? 'rounded-[16px_16px_4px_16px] bg-app-brand text-white'
            : 'rounded-[16px_16px_16px_4px] bg-white',
        )}
      >
        {mine ? <span className="sr-only">{copy.you}: </span> : null}
        {item.text}
      </div>
      {item.delivery === 'sending' ? (
        <span className="text-12 text-app-muted" aria-hidden="true">
          {copy.sending}
        </span>
      ) : item.delivery === 'failed' ? (
        <span
          className="flex items-center gap-1.5 text-12 font-medium text-danger-strong"
          role="alert"
        >
          <CircleAlert size={13} aria-hidden="true" />
          {copy.notSent}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-app-brand underline-offset-2 hover:underline"
            onClick={() => item.clientMessageId && onRetry?.(item.clientMessageId)}
          >
            {copy.retry}
          </button>
        </span>
      ) : (
        <span className="text-11 text-app-muted" aria-hidden="true">
          {formatTime(item.createdAt)}
        </span>
      )}
    </li>
  )
}
