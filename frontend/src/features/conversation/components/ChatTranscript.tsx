import { TranscriptMessage } from './TranscriptMessage'
import type { TranscriptItem } from '../model'

export interface ChatTranscriptProps {
  items: readonly TranscriptItem[]
  /** Re-send a failed message (absent in read-only transcripts). */
  onRetry?: (clientMessageId: string) => void
  /** Accessible name of the list (default "Mensajes"). */
  label?: string
}

/** Every turn in sequence order, then the messages still being sent. */
export function ChatTranscript({ items, onRetry, label = 'Mensajes' }: ChatTranscriptProps) {
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col gap-2.5 p-0">
      {items.map((item) => (
        <TranscriptMessage key={item.key} item={item} onRetry={onRetry} />
      ))}
    </ol>
  )
}
