import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, CircleAlert } from 'lucide-react'
import { Button, Callout, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import {
  conversationStatusLine,
  normalizeCustomerMessage,
  toChatItems,
  visibleSuggestions,
  type ChatItem,
} from '../model'
import { useCustomerChatLive, useCustomerConversation, useSendCustomerMessage } from '../hooks'

export interface CustomerChatProps {
  customerId: string
  /** Chips of this customer (from the picker list): openers or open-chat follow-ups. */
  suggestions: readonly string[]
}

/**
 * The customer's chat, framed like the mobile app support screen
 * (AppSupportChat.dc.html): "Soporte" + who is attending, the conversation,
 * opener chips and the input. Live through `customer:<id>`.
 */
export function CustomerChat({ customerId, suggestions }: CustomerChatProps) {
  useCustomerChatLive(customerId)
  const chat = useCustomerConversation(customerId)
  const { send, retry } = useSendCustomerMessage(customerId)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const items = useMemo(() => (chat.data ? toChatItems(chat.data) : []), [chat.data])
  const scrollRef = useScrollToEnd(items)
  const conversation = chat.data?.conversation ?? null
  const chips = chat.status === 'success' ? visibleSuggestions(suggestions, chat.data) : []
  const message = normalizeCustomerMessage(text)

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
    <div className="mx-auto flex h-full max-h-[844px] w-full max-w-[390px] flex-col overflow-hidden rounded-16 border border-app-line bg-app-canvas text-app-ink shadow-popover">
      <header className="flex items-center gap-3 border-b border-app-line bg-white px-5 pt-[18px] pb-3">
        <span className="flex grow flex-col">
          <span className="text-16 font-semibold">Soporte</span>
          <span className="text-12 text-app-muted" aria-live="polite">
            {chat.status === 'success' ? conversationStatusLine(conversation) : 'Cargando…'}
          </span>
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
            title="No pudimos cargar la conversación"
            actions={
              <Button size="sm" loading={chat.isFetching} onClick={() => void chat.refetch()}>
                Reintentar
              </Button>
            }
          >
            Revisa tu conexión e inténtalo de nuevo.
          </Callout>
        ) : (
          // The log mounts with the history already in it, so only messages
          // added afterwards are announced (ARCHITECTURE.md §11).
          <div role="log" aria-label="Conversación con soporte" aria-relevant="additions">
            <ol aria-label="Mensajes" className="m-0 flex list-none flex-col gap-3 p-0">
              {items.length === 0 ? (
                <li className="self-start rounded-[16px_16px_16px_4px] bg-white px-3.5 py-2.5 text-15 leading-[1.45]">
                  Hola, ¿en qué te podemos ayudar?
                </li>
              ) : null}
              {items.map((item) => (
                <ChatBubble key={item.key} item={item} onRetry={retry} />
              ))}
            </ol>
          </div>
        )}
        {chips.length > 0 ? (
          <fieldset className="m-0 flex min-w-0 flex-col items-start gap-2 border-0 p-0">
            <legend className="sr-only">Sugerencias</legend>
            {chips.map((suggestion) => (
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

      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-app-line bg-white px-4 pt-3 pb-[26px]"
      >
        <label htmlFor="customer-message" className="sr-only">
          Escribe tu mensaje
        </label>
        <input
          ref={inputRef}
          id="customer-message"
          type="text"
          autoComplete="off"
          placeholder="Escribe aquí"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-11 grow rounded-full border-0 bg-app-canvas px-4 text-15 text-app-ink placeholder:text-app-muted"
        />
        <button
          type="submit"
          aria-label="Enviar"
          aria-disabled={!message || undefined}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-app-brand text-white hover:bg-app-brand-strong aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </form>
    </div>
  )
}

function ChatBubble({ item, onRetry }: { item: ChatItem; onRetry: (id: string) => void }) {
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
        {mine ? <span className="sr-only">Tú: </span> : null}
        {item.text}
      </div>
      {item.delivery === 'sending' ? (
        <span className="text-12 text-app-muted" aria-hidden="true">
          Enviando…
        </span>
      ) : item.delivery === 'failed' ? (
        <span
          className="flex items-center gap-1.5 text-12 font-medium text-danger-strong"
          role="alert"
        >
          <CircleAlert size={13} aria-hidden="true" />
          No se envió ·
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-app-brand underline-offset-2 hover:underline"
            onClick={() => item.clientMessageId && onRetry(item.clientMessageId)}
          >
            Reintentar
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

/** Keeps the newest message in view when it arrives (the customer reads from the bottom). */
function useScrollToEnd(items: readonly ChatItem[]) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (element) element.scrollTop = element.scrollHeight
  }, [items])
  return ref
}
