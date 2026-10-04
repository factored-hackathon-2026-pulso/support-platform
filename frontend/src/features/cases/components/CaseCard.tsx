import { Fact, ListItemButton, Status } from '@/components/ui'
import {
  ESCALATED_MARKER,
  caseCardFacts,
  caseStatus,
  closeReasonLabel,
  formatClosedAgo,
  formatLastInteraction,
  ratingFact,
  slaFact,
  inboxStatusMeta,
} from '../model'
import type { CaseSummary } from '../types'
import { CloseReasonIcon } from './CloseReasonIcon'

export interface CaseCardProps {
  summary: CaseSummary
  selected: boolean
  now: number
  onSelect: (caseId: string) => void
}

/**
 * One case of the list (contract §9.1; slice 6 UI rule: short facts, never a
 * dot-joined line). Open: left stripe = status, the name and the first-response
 * "SLA x" (clock, only while the first reply is pending) on top, the last
 * message, then the status (glyph + word), the channel, the priority glyph when high or
 * critical (slice 8), "Escalado" while an escalation to supervision is open (slice 9) and
 * "Volvió a escribir", and the time since the last interaction
 * (clock). Closed (Cerrados): when it closed, the last message, the "Cerrado" status, the
 * reason with its icon and, once the customer rated it (slice 7), the face alone (tooltip
 * and accessible text "Calificación: Bien").
 */
export function CaseCard({ summary, selected, now, onSelect }: CaseCardProps) {
  const meta = inboxStatusMeta(summary)
  const closed = summary.status === 'closed'
  const sla = closed ? null : slaFact(summary, now)
  const closedAgo = closed ? formatClosedAgo(summary, now) : null
  const rating = closed ? ratingFact(summary.rating) : null
  return (
    <ListItemButton
      selected={selected}
      tone={meta.tone}
      markWidth={4}
      title={meta.subLabel}
      onClick={() => onSelect(summary.id)}
      className="flex flex-col gap-1 border-t border-b-0 border-t-border py-[11px] pr-3.5 pl-3"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-15 font-semibold">{summary.customer.displayName}</span>
        {closedAgo ? (
          <Fact
            icon="clock"
            text={closedAgo}
            tone="muted"
            label="Cerrado"
            focusable={false}
            className="shrink-0"
          />
        ) : sla ? (
          <Fact
            icon={sla.icon}
            text={sla.text}
            tone={sla.tone}
            label={sla.label}
            tooltip={sla.tooltip}
            focusable={false}
            className="shrink-0 font-semibold"
          />
        ) : null}
      </span>
      <span className="truncate text-13 text-ink-2">
        {summary.preview ?? 'Sin mensajes todavía'}
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <Status {...caseStatus(summary.inboxStatus)} />
          {!closed && summary.escalated ? <Status {...ESCALATED_MARKER} /> : null}
          {closed ? (
            <>
              <span className="flex min-w-0 items-center gap-1.5 text-12 text-ink-2">
                {summary.closeReason ? <CloseReasonIcon reason={summary.closeReason} /> : null}
                <span className="truncate">{closeReasonLabel(summary.closeReason)}</span>
              </span>
              {rating ? (
                <Fact
                  icon={rating.icon}
                  text={rating.text}
                  tone={rating.tone}
                  iconOnly
                  focusable={false}
                />
              ) : null}
            </>
          ) : (
            caseCardFacts(summary).map(({ key, ...fact }) => (
              <Fact key={key} {...fact} focusable={false} />
            ))
          )}
        </span>
        {closed ? null : (
          <Fact
            icon="clock"
            text={formatLastInteraction(summary, now)}
            tone="muted"
            label="Última actividad"
            tooltip="Última actividad"
            focusable={false}
            className="shrink-0"
          />
        )}
      </span>
    </ListItemButton>
  )
}
