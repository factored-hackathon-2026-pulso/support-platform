import { useId, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { emailSnippet } from '../channels'
import type { TranscriptItem } from '../model'

/**
 * One email of the thread (slice 12, canvas "correo"): a row with the sender, the date and
 * "Nuevo" for a customer email nobody answered yet; collapsed to one line (the snippet) or
 * open with the whole body. Unanswered emails and the newest start open; the rest start collapsed.
 */
export function EmailCard({ item, defaultOpen }: { item: TranscriptItem; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? Boolean(item.isNew || item.latest))
  const bodyId = useId()
  const customer = item.speaker === 'customer'
  return (
    <li>
      <article
        aria-label={`Correo de ${item.author ?? ''}`}
        className={cn(
          'flex flex-col rounded-12 border bg-surface',
          item.isNew ? 'border-accent-border' : 'border-border',
        )}
      >
        <h4 className="m-0">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={() => setOpen((value) => !value)}
            className="flex w-full cursor-pointer items-center gap-3 rounded-12 border-0 bg-transparent px-4 py-3 text-left"
          >
            <Avatar
              name={item.author ?? ''}
              initials={item.initials}
              tone={customer ? 'neutral' : 'accent'}
              size="sm"
              decorative
            />
            <span className="flex min-w-0 grow flex-col">
              <span className="text-14 font-semibold text-ink">{item.author}</span>
              {open ? null : (
                <span className="truncate text-13 font-normal text-muted">
                  {emailSnippet(item.text)}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-12 font-normal text-muted">
              {item.isNew ? (
                <span className="inline-flex items-center gap-1 font-semibold text-accent-strong">
                  <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
                  Nuevo
                </span>
              ) : null}
              <span>{formatDateTime(item.createdAt, { withYear: false })}</span>
              {open ? (
                <ChevronDown size={14} aria-hidden="true" />
              ) : (
                <ChevronRight size={14} aria-hidden="true" />
              )}
            </span>
          </button>
        </h4>
        {open ? (
          <div
            id={bodyId}
            className="border-t border-divider px-4 py-3 text-15 leading-[1.5] break-words whitespace-pre-line text-ink"
          >
            {item.text}
          </div>
        ) : null}
      </article>
    </li>
  )
}
