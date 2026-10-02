import { useId, useState } from 'react'
import { useCurrentUser } from '@/app/session'
import { Kicker, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { inputsSentence, routeLine, routeSteps } from '../model'
import { useCaseDetail } from '../hooks/use-case-detail'

export interface RoutingSummaryProps {
  caseId: string
  /** Start expanded (canvas `recorrido`). */
  defaultOpen?: boolean
}

/**
 * "CÓMO LLEGÓ A TI" (Workspace.dc.html, Cliente tab): one-line route, and on
 * "Ver" every stop (entry, automatic tiers, queue, assignee) with what it did
 * and which customer data the automatic tiers read.
 */
export function RoutingSummary({ caseId, defaultOpen = false }: RoutingSummaryProps) {
  const me = useCurrentUser()
  const detail = useCaseDetail(caseId)
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  if (detail.status === 'pending') {
    return (
      <div aria-busy="true" className="flex flex-col gap-2 rounded-10 border border-border p-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-4 w-56" />
      </div>
    )
  }
  if (detail.status === 'error') {
    return (
      <p className="m-0 rounded-10 border border-border px-3 py-2.5 text-13 text-ink-2">
        No pudimos cargar cómo llegó el caso.
      </p>
    )
  }

  const steps = routeSteps(detail.data, me.id)
  return (
    <div className="overflow-hidden rounded-10 border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-surface px-3 py-2.5 text-left text-ink"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <Kicker>Cómo llegó a ti</Kicker>
          <span className="truncate text-13">{routeLine(detail.data.routing.stops, me.id)}</span>
        </span>
        <span className="shrink-0 text-13 font-semibold text-accent">
          {open ? 'Ocultar' : 'Ver'}
        </span>
      </button>
      <div id={panelId} hidden={!open}>
        <ol className="m-0 flex list-none flex-col gap-2.5 border-t border-border-soft px-3 pt-1 pb-3">
          {steps.map((step) => (
            <li key={step.key} className="flex gap-2.5 pt-2">
              <span
                aria-hidden="true"
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  step.current ? 'bg-ink' : 'bg-offline',
                )}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-13 font-semibold">{step.title}</span>
                {step.lines.map((line) => (
                  <span key={line} className="text-12 leading-[1.4] text-ink-2">
                    {line}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
        <p className="m-0 px-3 pb-3 text-12 leading-[1.4] text-muted">
          {inputsSentence(detail.data.routing.inputsUsed)}
        </p>
      </div>
    </div>
  )
}
