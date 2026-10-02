import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { emailSnippet, type TranscriptItem } from '../model'

export interface EmailThreadProps {
  items: readonly TranscriptItem[]
}

/**
 * E-mail layout (read-only seam, canvas `correo`): one card per mail; the latest
 * is open, older ones show their first line and open on demand.
 */
export function EmailThread({ items }: EmailThreadProps) {
  const mails = items.filter((item) => item.variant !== 'routing' && item.variant !== 'notice')
  const lastKey = mails[mails.length - 1]?.key
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  if (mails.length === 0) {
    return <p className="m-0 text-14 text-ink-2">Todavía no hay correos en este caso.</p>
  }
  return (
    <ol aria-label="Correos" className="m-0 flex list-none flex-col gap-2.5 p-0">
      {mails.map((mail) => {
        const open = mail.key === lastKey || expanded.has(mail.key)
        const bodyId = `mail-${mail.key}`
        return (
          <li key={mail.key}>
            <article className="flex flex-col gap-1.5 rounded-12 border border-border bg-surface px-3.5 py-2.5">
              <header className="flex justify-between gap-3 text-13">
                <span className="font-semibold">{mail.author}</span>
                <span className="shrink-0 text-muted">{formatDateTime(mail.createdAt)}</span>
              </header>
              {open ? (
                <p id={bodyId} className="m-0 text-15 leading-normal whitespace-pre-line">
                  {mail.text}
                </p>
              ) : (
                <button
                  type="button"
                  aria-expanded={false}
                  className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-13 text-ink-2"
                  onClick={() => setExpanded((current) => new Set(current).add(mail.key))}
                >
                  <span className="truncate">{emailSnippet(mail.text)}</span>
                  <ChevronDown size={14} aria-hidden="true" className="shrink-0" />
                  <span className="sr-only">Ver el correo completo</span>
                </button>
              )}
            </article>
          </li>
        )
      })}
    </ol>
  )
}
