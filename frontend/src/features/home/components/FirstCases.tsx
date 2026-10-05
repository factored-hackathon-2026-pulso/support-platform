import { CheckCircle2 } from 'lucide-react'
import {
  EmptyState,
  Fact,
  FactList,
  LinkButton,
  QueryState,
  Skeleton,
  Status,
  toneBorderLeft,
} from '@/components/ui'
import type { InboxResponse } from '@/features/cases'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import { firstCases } from '../model'

export interface FirstCasesProps {
  inbox: {
    status: 'pending' | 'error' | 'success'
    data: InboxResponse | undefined
    isFetching?: boolean
    refetch: () => unknown
  }
  now: number
  paused: boolean
}

/**
 * "Lo primero" (canvas `queue`): her open cases in urgency order (the same
 * `sortByUrgency` as the Casos list), each with its status stripe and status (glyph + word), "Escalado" while an
 * escalation is open (the Casos card marker), the
 * channel (and a high or critical priority glyph, "Volvió a escribir") as icons with a
 * tooltip, the last message, the SLA or the time, and "Abrir" (Casos with that
 * case open and its filter set, so the card is highlighted).
 */
export function FirstCases({ inbox, now, paused }: FirstCasesProps) {
  const { t } = useTranslation(['home', 'cases'])
  return (
    <section
      aria-labelledby="home-first"
      className="flex min-h-0 flex-col overflow-hidden rounded-14 border border-border bg-surface"
    >
      <div className="flex items-baseline justify-between px-5 pt-4 pb-2.5">
        <h2 id="home-first" className="m-0 text-17 font-semibold">
          {t('first.title')}
        </h2>
        <span className="text-13 text-muted">{t('first.subtitle')}</span>
      </div>
      <div className="min-h-0 scrollbar-thin overflow-y-auto [&>[role=alert]]:mx-5 [&>[role=alert]]:mb-4">
        <QueryState<InboxResponse>
          query={inbox}
          skeleton={<RowsSkeleton />}
          isEmpty={(data) => data.items.length === 0}
          empty={
            <EmptyState
              as="h3"
              size="compact"
              className="border-t border-border-soft py-8"
              icon={<CheckCircle2 size={32} strokeWidth={1.6} aria-hidden="true" />}
              title={t('first.emptyTitle')}
              description={paused ? t('first.emptyPaused') : t('first.emptyAvailable')}
            />
          }
          errorTitle={t('first.loadError')}
        >
          {(data) => (
            <ul aria-label={t('first.listLabel')} className="m-0 list-none p-0">
              {firstCases(data.items, now).map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_120px_88px] items-center gap-4 border-t border-l-4 border-t-border-soft py-3 pr-5 pl-4',
                    toneBorderLeft[row.status.tone],
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-15 font-semibold">{row.name}</span>
                      <Status {...row.status} className="shrink-0" />
                      {row.escalated ? <Status {...row.escalated} className="shrink-0" /> : null}
                      <FactList items={row.facts} className="shrink-0" />
                    </span>
                    <span className="truncate text-14 text-ink-2">{row.preview}</span>
                  </span>
                  {row.sla ? (
                    <Fact
                      icon={row.sla.icon}
                      text={row.sla.text}
                      tone={row.sla.tone}
                      label={row.sla.label}
                      tooltip={row.sla.tooltip}
                      size="md"
                      className="font-semibold"
                    />
                  ) : (
                    <Fact
                      icon={row.last.icon}
                      text={row.last.text}
                      label={row.last.label}
                      tooltip={row.last.tooltip}
                      tone={row.last.tone}
                      size="md"
                    />
                  )}
                  <LinkButton
                    to={row.href}
                    variant="secondary"
                    size="sm"
                    className="justify-self-end"
                    aria-label={t('first.openLabel', { name: row.name })}
                  >
                    {t('first.open')}
                  </LinkButton>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </div>
    </section>
  )
}

function RowsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex flex-col gap-2 border-t border-border-soft px-5 py-3">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-80" />
        </div>
      ))}
    </div>
  )
}
