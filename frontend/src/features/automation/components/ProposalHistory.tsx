import {
  CircleCheck,
  CircleDot,
  CircleX,
  FlaskConical,
  PencilLine,
  Rocket,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { useTranslation } from '@/lib/i18n'
import { historyView, type HistoryIcon } from '../proposals'
import type { ProposalHistoryEntry } from '../types'

const ICONS: Record<HistoryIcon, { icon: LucideIcon; className: string }> = {
  created: { icon: CircleDot, className: 'text-muted' },
  engine: { icon: Sparkles, className: 'text-accent-strong' },
  frozen: { icon: FlaskConical, className: 'text-ink-2' },
  passed: { icon: CircleCheck, className: 'text-success-ink' },
  failed: { icon: CircleX, className: 'text-danger' },
  approved: { icon: ThumbsUp, className: 'text-success-ink' },
  rejected: { icon: ThumbsDown, className: 'text-danger' },
  reopened: { icon: PencilLine, className: 'text-ink-2' },
  published: { icon: Send, className: 'text-accent-strong' },
  prod: { icon: Rocket, className: 'text-success-ink' },
}

export interface ProposalHistoryProps {
  entries: ProposalHistoryEntry[]
}

/**
 * The verdict story of a proposal (oldest first), Linear's activity style: how it got here, each
 * test with its criteria, the decisions (a rejection with agent-core's reason), the publication
 * and the way to production. From the platform's audit: steps taken in the registry directly are
 * not in it, and the note says so.
 */
export function ProposalHistory({ entries }: ProposalHistoryProps) {
  const { t } = useTranslation('automation')
  const items = historyView(entries)
  return (
    <section aria-labelledby="proposal-history" className="flex flex-col gap-3">
      <h2 id="proposal-history" className="m-0 text-15 font-semibold">
        {t('history.title')}
      </h2>
      {items.length === 0 ? (
        <p className="m-0 text-13 text-ink-2">{t('history.empty')}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-0 p-0">
          {items.map((item, index) => {
            const { icon: Icon, className } = ICONS[item.icon]
            return (
              <li key={item.key} className="relative flex gap-3 pb-3 last:pb-0">
                {index < items.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-6 bottom-0 left-[9px] w-px bg-border-soft"
                  />
                ) : null}
                <Icon size={19} aria-hidden="true" className={cn('mt-0.5 shrink-0', className)} />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-14">{item.text}</span>
                  {item.tag ? <Badge tone={item.tagTone}>{item.tag}</Badge> : null}
                  {item.releaseId ? (
                    <span className="font-mono text-12 text-ink-2">
                      {t('history.release', { id: item.releaseId })}
                    </span>
                  ) : null}
                </div>
                <time dateTime={item.at} className="shrink-0 pt-0.5 text-12 text-muted">
                  {formatDateTime(item.at)}
                </time>
              </li>
            )
          })}
        </ol>
      )}
      <p className="m-0 text-12 text-muted">{t('history.note')}</p>
    </section>
  )
}
