import { useLocation } from 'react-router'
import { MousePointerClick } from 'lucide-react'
import { supervisionCasePath } from '@/app/paths'
import {
  Accordion,
  AccordionItem,
  Button,
  Callout,
  EmptyState,
  Fact,
  KeyValueList,
  Kicker,
  LinkButton,
  Spinner,
} from '@/components/ui'
import { isApiProblem, type ApiProblem } from '@/lib/api'
import { useTranslation } from '@/lib/i18n'
import { detailByline, detailKicker, eventInstant, payloadLines, redactionNote } from '../model'
import type { AuditEvent } from '../types'

export interface AuditDetailProps {
  /** `?event=`; null = nothing selected. */
  eventId: string | null
  /** The event when it is in the loaded pages, or once fetched by id. */
  event: AuditEvent | undefined
  /** Fetching it by id (not in the loaded pages). */
  loading: boolean
  error: ApiProblem | null
  onRetry(): void
  onFilterByCase(caseId: string): void
  /** Offer "Ver la conversación" (the supervisor case view). Default true. */
  canOpenCases?: boolean
}

/**
 * "Detalle del registro" (SuAudit, contract §8.8): what happened, who did it,
 * the ids, the redacted payload, and the way to the conversation (the audited
 * supervisor view) or to the case's other events.
 */
export function AuditDetail({
  eventId,
  event,
  loading,
  error,
  onRetry,
  onFilterByCase,
  canOpenCases = true,
}: AuditDetailProps) {
  const { t } = useTranslation(['audit', 'common'])
  let body
  if (!eventId) {
    body = (
      <EmptyState
        size="compact"
        as="h2"
        icon={<MousePointerClick size={32} strokeWidth={1.6} />}
        title={t('detail.pick')}
        className="grow"
      />
    )
  } else if (event) {
    body = <EventDetail event={event} onFilterByCase={onFilterByCase} canOpenCases={canOpenCases} />
  } else if (error) {
    body = isApiProblem(error, 'not_found') ? (
      <EmptyState size="compact" as="h2" title={t('detail.notFound')} className="grow" />
    ) : (
      <div className="p-5">
        <Callout
          tone="danger"
          title={t('detail.errorTitle')}
          actions={
            <Button size="sm" onClick={onRetry}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {t('common:query.errorDescription')}
        </Callout>
      </div>
    )
  } else {
    body = (
      <div className="flex grow items-center justify-center text-muted">
        {loading ? <Spinner label={t('detail.loading')} size={24} /> : null}
      </div>
    )
  }
  return (
    <aside
      aria-label={t('detail.region')}
      className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface"
    >
      {body}
    </aside>
  )
}

function EventDetail({
  event,
  onFilterByCase,
  canOpenCases,
}: {
  event: AuditEvent
  onFilterByCase(caseId: string): void
  canOpenCases: boolean
}) {
  const { t } = useTranslation(['audit', 'common'])
  const location = useLocation()
  const lines = payloadLines(event.payload)
  const caseRef = event.caseRef
  const kicker = detailKicker(event)
  const byline = detailByline(event.actor)
  return (
    <>
      <div className="flex flex-col gap-1 border-b border-border-soft px-5 pt-[18px] pb-3.5">
        <span className="flex items-center gap-3">
          <Fact icon="clock" text={kicker.time} label={t('detail.time')} tone="muted" />
          <Kicker>{kicker.family}</Kicker>
        </span>
        <h2 className="m-0 text-18 leading-[1.3] font-semibold">{event.description}</h2>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Fact icon="user" text={byline.name} label={t('detail.who')} size="md" />
          {byline.role ? (
            <Fact
              icon="users"
              text={byline.role}
              label={t('common:fields.role')}
              tone="muted"
              size="md"
            />
          ) : null}
        </span>
      </div>
      <div className="flex flex-col gap-4 px-5 py-3.5">
        <KeyValueList
          labelWidth={100}
          items={[
            { key: 'id', label: t('detail.fields.event'), value: event.id, mono: true },
            { key: 'type', label: t('detail.fields.type'), value: event.type, mono: true },
            ...(caseRef
              ? [
                  {
                    key: 'case',
                    label: t('detail.fields.case'),
                    value: (
                      <span className="flex flex-col">
                        <span className="font-mono text-12">{caseRef.id}</span>
                        {caseRef.customerName ? (
                          <span className="text-14">{caseRef.customerName}</span>
                        ) : null}
                      </span>
                    ),
                  },
                ]
              : []),
            { key: 'actor', label: t('detail.fields.actor'), value: event.actor.id, mono: true },
            {
              key: 'occurred',
              label: t('detail.fields.occurred'),
              value: eventInstant(event.occurredAt),
            },
            {
              key: 'ingested',
              label: t('detail.fields.ingested'),
              value: eventInstant(event.ingestedAt),
            },
          ]}
        />
        {lines.length > 0 ? (
          <Accordion>
            <AccordionItem value="payload" title={t('detail.payload')} count={lines.length}>
              <dl className="m-0 flex flex-col gap-1 font-mono text-12">
                {lines.map((line) => (
                  <div key={line.key} className="flex gap-2">
                    <dt className="shrink-0 text-muted">{line.key}</dt>
                    <dd className="m-0 min-w-0 break-all text-ink">{line.value}</dd>
                  </div>
                ))}
              </dl>
            </AccordionItem>
          </Accordion>
        ) : null}
        {redactionNote(event) ? (
          <p className="m-0 text-13 text-muted">{redactionNote(event)}</p>
        ) : null}
      </div>
      {caseRef ? (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-border-soft px-5 py-3.5">
          {canOpenCases ? (
            <LinkButton
              to={supervisionCasePath(caseRef.id)}
              state={{ from: `${location.pathname}${location.search}` }}
              variant="secondary"
            >
              {t('detail.openConversation')}
            </LinkButton>
          ) : null}
          <Button variant="ghost" onClick={() => onFilterByCase(caseRef.id)}>
            {t('detail.filterByCase')}
          </Button>
        </div>
      ) : null}
    </>
  )
}
