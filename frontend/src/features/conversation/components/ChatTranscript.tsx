import { TranscriptMessage } from './TranscriptMessage'
import type { TranscriptItem } from '../model'

export interface ChatTranscriptProps {
  items: readonly TranscriptItem[]
  onRetry: (clientMessageId: string) => void
}

/** Chat layout: every turn in sequence order, then the messages still being sent. */
export function ChatTranscript({ items, onRetry }: ChatTranscriptProps) {
  return (
    <ol aria-label="Mensajes" className="m-0 flex list-none flex-col gap-2.5 p-0">
      {items.map((item) => (
        <TranscriptMessage key={item.key} item={item} onRetry={onRetry} />
      ))}
    </ol>
  )
}
