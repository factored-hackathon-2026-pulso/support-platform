import { useState } from 'react'
import { CircleArrowUp } from 'lucide-react'
import { Avatar, Button, Fact } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import { useAcknowledgeEscalation, useWithdrawEscalation } from '../hooks/use-escalation'
import type { EscalationCard as EscalationCardModel } from '../model'

export interface EscalationCardProps {
  caseId: string
  card: EscalationCardModel
}

/**
 * The staff-only escalation card under the conversation header (Workspace.dc.html "escalado" /
 * "respondido", slice 9): the open escalation (icon tile, "Escalado a supervisión", "Solo el
 * equipo", how long ago, the motive in one line with "Ver más", "Retirar escalamiento"), or
 * what supervision did (their avatar, who did what, their answer, "Tu motivo", "Entendido").
 * Never sent to the customer: the backend keeps escalations off customer topics.
 */
export function EscalationCard({ caseId, card }: EscalationCardProps) {
  const { t } = useTranslation('conversation')
  const [expanded, setExpanded] = useState(false)
  const withdraw = useWithdrawEscalation(caseId)
  const acknowledge = useAcknowledgeEscalation(caseId)
  const attended = card.kind === 'attended'
  const motiveLead = attended
    ? `${t('escalation.card.yourMotive')} `
    : card.byName
      ? `${card.byName}: `
      : ''

  return (
    <div className="shrink-0 border-b border-border bg-canvas px-6 py-2.5">
      <section
        aria-label={t('escalation.card.region')}
        className={cn(
          'mx-auto flex w-full max-w-[880px] flex-wrap items-start gap-x-3 gap-y-2 rounded-12 border px-3 py-2.5',
          attended ? 'border-accent-border bg-accent-soft' : 'border-border bg-surface',
        )}
      >
        {attended ? (
          <Avatar
            name={card.resolverName}
            tone="accent"
            size="sm"
            decorative
            className="bg-surface"
          />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-8 bg-warn-soft text-warn">
            <CircleArrowUp size={18} aria-hidden="true" />
          </span>
        )}
        <div className="flex min-w-0 grow basis-64 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-14 font-semibold text-ink">{card.title}</span>
            <Fact icon="users" text={t('escalation.card.teamOnly')} tone="muted" />
            <Fact icon="clock" text={card.since} tone="muted" tooltip={card.sinceTooltip} />
          </div>
          {attended && card.note ? <p className="m-0 text-14 text-ink">{card.note}</p> : null}
          <div className="flex min-w-0 items-baseline gap-2">
            <p
              className={cn(
                'm-0 min-w-0 grow',
                attended ? 'text-13 text-ink-2' : 'text-14 text-ink',
                expanded ? 'whitespace-pre-wrap' : 'truncate',
              )}
            >
              {motiveLead ? <span className="font-medium">{motiveLead}</span> : null}
              {card.escalation.motive}
            </p>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="shrink-0 cursor-pointer rounded-8 text-13 font-medium text-accent-strong hover:underline"
            >
              {expanded ? t('escalation.card.less') : t('escalation.card.more')}
            </button>
          </div>
        </div>
        {card.kind === 'open' && card.canWithdraw ? (
          <Button
            size="sm"
            variant="secondary"
            loading={withdraw.isPending}
            className="ml-auto self-center"
            onClick={() => withdraw.mutate(card.escalation)}
          >
            {t('escalation.card.withdraw')}
          </Button>
        ) : null}
        {attended ? (
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto self-center"
            onClick={() => acknowledge.mutate(card.escalation)}
          >
            {t('escalation.card.acknowledge')}
          </Button>
        ) : null}
      </section>
    </div>
  )
}
