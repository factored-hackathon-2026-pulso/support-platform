import { useCurrentUser } from '@/app/session'
import { SidePanelSection } from '@/components/layout'
import {
  Badge,
  Button,
  Callout,
  Fact,
  FACT_ICONS,
  FactList,
  Skeleton,
  Status,
  type FactIcon,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useNow } from '@/lib/hooks'
import { useCaseDetail } from '../hooks'
import {
  arrivalFacts,
  caseRows,
  customerRows,
  describeCaseLoadFailure,
  previousCasesSectionTitle,
  type FileRow,
} from '../model'
import type { CaseDetail } from '../types'
import { CaseHistoryBrowser } from './CaseHistorySheet'
import { CasePriorityControl } from './CasePriorityControl'

export interface CustomerFileProps {
  /** The case open in the Workspace. */
  caseId: string
  /** "Casos anteriores": `'lista'` (default) or a past case id (`?historial=`). */
  history: string | null
  onHistoryChange(history: string): void
}

/** The SLA state ticks with the list (30 s). */
const TICK_MS = 30_000

/**
 * The sections of "Ficha del cliente" (slice 6 §5), rendered inside the
 * Workspace's `SidePanel`. Only data the platform already has: who the customer
 * is, this case, how it reached her, and "Casos anteriores (n)" with their
 * read-only transcripts. One fact per row (icon + label, a short value, the
 * status as a pill, times with a clock); never a dot-joined line or a sentence.
 * No bank data, no AI, no placeholders.
 */
export function CustomerFile({ caseId, history, onHistoryChange }: CustomerFileProps) {
  const me = useCurrentUser()
  const now = useNow(TICK_MS)
  const detail = useCaseDetail(caseId)

  if (detail.status === 'pending') {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-48" />
      </div>
    )
  }
  if (detail.status === 'error') {
    const failure = describeCaseLoadFailure(detail.error)
    return (
      <Callout
        tone="danger"
        title={failure.title}
        actions={
          <Button size="sm" loading={detail.isFetching} onClick={() => void detail.refetch()}>
            Reintentar
          </Button>
        }
      >
        {failure.description}
      </Callout>
    )
  }

  const arrival = arrivalFacts(detail.data, me.id)
  return (
    <>
      <SidePanelSection title="Cliente">
        <FileRows rows={customerRows(detail.data)} />
      </SidePanelSection>
      <SidePanelSection title="Este caso">
        <FileRows rows={caseRows(detail.data, now)} detail={detail.data} />
      </SidePanelSection>
      {arrival ? (
        <SidePanelSection title={arrival.heading}>
          {arrival.time ? (
            <Fact icon="clock" text={arrival.time} label="Asignado" tone="muted" size="md" />
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {arrival.facts.map(({ key, ...fact }) => (
              <li key={key} className="flex">
                <Fact {...fact} size="md" />
              </li>
            ))}
          </ul>
        </SidePanelSection>
      ) : null}
      <SidePanelSection title={previousCasesSectionTitle(detail.data.previousCaseCount)}>
        <CaseHistoryBrowser
          caseId={caseId}
          selected={history ?? 'lista'}
          onSelect={onHistoryChange}
          headingLevel="h4"
        />
      </SidePanelSection>
    </>
  )
}

function pillIcon(icon: FactIcon | undefined) {
  if (!icon) return undefined
  const Icon = FACT_ICONS[icon]
  return <Icon size={13} aria-hidden="true" className="shrink-0" />
}

/**
 * Label column (icon + label) and value column: text, the status, a rating pill, short
 * facts, or (slice 8) the priority menu of `detail`.
 */
function FileRows({
  rows,
  detail,
}: {
  rows: readonly FileRow[]
  detail?: Pick<CaseDetail, 'case' | 'capabilities'>
}) {
  return (
    <dl className="m-0 grid grid-cols-[148px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-14">
      {rows.map((row) => {
        const Icon = FACT_ICONS[row.icon]
        return (
          <div key={row.key} className="contents">
            <dt className="flex items-center gap-1.5 text-muted">
              <Icon size={14} aria-hidden="true" className="shrink-0" />
              {row.label}
            </dt>
            <dd
              className={cn('m-0 min-w-0 break-words', row.mono && 'truncate font-mono text-12')}
              title={row.mono ? row.text : undefined}
            >
              {row.priority && detail ? (
                <CasePriorityControl detail={detail} align="end" />
              ) : row.status ? (
                <Status {...row.status} />
              ) : row.pill ? (
                <Badge tone={row.pill.tone} size="sm" icon={pillIcon(row.pill.icon)}>
                  {row.pill.label}
                </Badge>
              ) : row.facts ? (
                <FactList items={row.facts} size="md" />
              ) : (
                row.text
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
