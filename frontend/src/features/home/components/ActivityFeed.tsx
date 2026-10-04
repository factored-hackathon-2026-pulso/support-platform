import { useState } from 'react'
import { Link } from 'react-router'
import { CheckCircle2, LogIn, LogOut, MessageSquare, RotateCcw } from 'lucide-react'
import { Button, Callout, Fact, FactList, Skeleton, Status } from '@/components/ui'
import { CloseReasonIcon, closeReasonLabel } from '@/features/cases'
import type { ApiProblem } from '@/lib/api'
import { cn } from '@/lib/cn'
import {
  EMPTY_FEED_COPY,
  FEED_PREVIEW_ROWS,
  activityLinkLabel,
  activityRow,
  feedToggleLabel,
  feedTruncatedNote,
  sinceFacts,
  type ActivityIcon,
} from '../model'
import type { AnalystHome } from '../types'

const ICONS: Record<ActivityIcon, typeof LogIn> = {
  in: LogIn,
  back: RotateCcw,
  out: LogOut,
  msg: MessageSquare,
}

/** Canvas `look`: in/back accent, out neutral, msg warn. */
const ICON_TONE: Record<ActivityIcon, string> = {
  in: 'bg-accent-soft text-accent',
  back: 'bg-accent-soft text-accent',
  out: 'bg-panel text-ink-2',
  msg: 'bg-warn-soft text-warn',
}

export interface ActivityFeedProps {
  home: {
    status: 'pending' | 'error' | 'success'
    data: AnalystHome | undefined
    error: ApiProblem | null
    isFetching: boolean
    refetch: () => unknown
  }
  now: number
}

/**
 * "Mientras no estabas" (canvas `feed`): what happened in her cases since her
 * previous session, one row per fact with a fixed template (model.ts): the
 * customer, the phrase, the status pill and short facts (icon + 1–3 words), the
 * time; newest first. Every row links to the case ("Ya no es tuyo" ones open
 * read-only). The first four show; "Ver todo (n)" expands the list in place. No
 * live region: the feed is not announced as it refreshes.
 */
export function ActivityFeed({ home, now }: ActivityFeedProps) {
  const [expanded, setExpanded] = useState(false)
  const data = home.data

  let body
  if (home.status === 'pending') {
    body = (
      <div aria-busy="true" className="flex flex-col gap-2 border-t border-border-soft px-5 py-3">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-4 w-60" />
      </div>
    )
  } else if (home.status === 'error' || !data) {
    body = (
      <div className="px-5 pb-4">
        <Callout
          tone="danger"
          title="No pudimos cargar lo que pasó"
          actions={
            <Button size="sm" loading={home.isFetching} onClick={() => void home.refetch()}>
              Reintentar
            </Button>
          }
        >
          Revisa tu conexión e inténtalo de nuevo.
        </Callout>
      </div>
    )
  } else if (data.activity.items.length === 0) {
    body = (
      <p className="m-0 flex items-center gap-2 border-t border-border-soft px-5 py-4 text-14 text-ink-2">
        <CheckCircle2 size={16} aria-hidden="true" className="text-muted" />
        {EMPTY_FEED_COPY}
      </p>
    )
  } else {
    const rows = data.activity.items.map((item) => activityRow(item, now))
    const shown = expanded ? rows : rows.slice(0, FEED_PREVIEW_ROWS)
    const toggle = feedToggleLabel(shown.length, data.activity.total, expanded)
    const note = expanded ? feedTruncatedNote(rows.length, data.activity.total) : null
    body = (
      <>
        <ul id="home-feed-list" aria-labelledby="home-since" className="m-0 list-none p-0">
          {shown.map((row) => {
            const Icon = ICONS[row.icon]
            const reason = row.lastCloseReason
            return (
              <li key={row.key}>
                <Link
                  to={row.href}
                  aria-label={activityLinkLabel(row, reason ? closeReasonLabel(reason) : undefined)}
                  className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-2.5 border-t border-border-soft px-5 py-2.5 text-ink hover:bg-subtle"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex size-7 items-center justify-center rounded-8',
                      ICON_TONE[row.icon],
                    )}
                  >
                    <Icon size={15} strokeWidth={2.2} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <strong className="truncate text-14 font-semibold">{row.customerName}</strong>
                      {row.status ? <Status {...row.status} className="shrink-0" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-13 text-ink-2">{row.phrase}</span>
                      {row.facts.map(({ key, ...fact }) => (
                        <Fact key={key} {...fact} focusable={false} />
                      ))}
                      {reason ? (
                        <span className="inline-flex items-center gap-1 text-12 text-ink-2">
                          <CloseReasonIcon reason={reason} />
                          {closeReasonLabel(reason)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <Fact icon="clock" text={row.when} tone="muted" focusable={false} />
                </Link>
              </li>
            )
          })}
        </ul>
        {note ? <p className="m-0 px-5 py-2 text-12 text-muted">{note}</p> : null}
        {toggle ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="home-feed-list"
            onClick={() => setExpanded((value) => !value)}
            className="cursor-pointer border-t border-border-soft px-5 py-2.5 text-left text-13 font-semibold text-accent hover:text-accent-strong"
          >
            {toggle}
          </button>
        ) : null}
      </>
    )
  }

  return (
    <section
      aria-labelledby="home-since"
      className="flex flex-col overflow-hidden rounded-14 border border-border bg-surface"
    >
      <div className="flex flex-col gap-1 px-5 pt-4 pb-2.5">
        <h2 id="home-since" className="m-0 text-17 font-semibold">
          Mientras no estabas
        </h2>
        {data ? <FactList items={sinceFacts(data, now)} /> : null}
      </div>
      <div>{body}</div>
    </section>
  )
}
