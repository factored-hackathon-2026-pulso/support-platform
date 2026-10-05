import { useId, type ReactNode } from 'react'
import {
  ArrowRight,
  Bot,
  Check,
  CircleHelp,
  Eye,
  Hand,
  Inbox,
  List,
  MessageCircle,
  RefreshCcw,
  type LucideIcon,
} from 'lucide-react'
import { Button, Callout, PriorityIcon, Skeleton } from '@/components/ui'
import { casePriority } from '@/features/cases'
import { cn } from '@/lib/cn'
import {
  HANDOFF_EMPTY,
  describeHandoffFailure,
  verifiedCountLabel,
  type HandoffItem,
  type HandoffView,
} from '../handoff'
import { useCaseHandoff } from '../hooks'
import type { CaseDetail } from '../types'

/** "Solo el equipo": the packet is staff-only (the customer never sees it). */
function TeamOnlyChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-[7px] text-11 font-semibold text-ink-2">
      <Eye size={12} aria-hidden="true" />
      Solo el equipo
    </span>
  )
}

/** The assistant's avatar: the stroke bot in a pale blue disc. */
function AssistantAvatar() {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong"
    >
      <Bot size={16} />
    </span>
  )
}

/** The priority the assistant saw: glyph + word, named for screen readers. */
function SeenPriority({ priority }: { priority: NonNullable<HandoffView['priority']> }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-13"
      title="Prioridad que vio el asistente"
    >
      <PriorityIcon level={priority} size={14} />
      <span className="sr-only">Prioridad que vio el asistente: </span>
      <span className="font-semibold text-ink">{casePriority(priority).label}</span>
    </span>
  )
}

function SuggestedQueue({ queue }: { queue: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-13 text-ink-2"
      title="Cola que sugirió el asistente"
    >
      <Inbox size={14} aria-hidden="true" />
      <span className="sr-only">Cola que sugirió el asistente: </span>
      {queue}
    </span>
  )
}

export interface HandoffCardProps {
  detail: Pick<CaseDetail, 'case' | 'assignment'>
  /** "Ver todo": opens the "Traspaso" tab of the right panel. */
  onOpen(): void
}

/**
 * "El asistente te pasó este caso" (IaWorkspace "iaTraspaso", slice 19): a compact card on top of
 * the conversation of a case that reached her from an assistant escalation, while it is open
 * and AI is on. It leads with why it was handed over, the priority the assistant saw, the
 * queue it suggested and how much it verified, and "Ver todo" opens the "Traspaso" tab. An
 * agent-core outage shows "Reintentar" here and never blocks the conversation; a handoff that
 * cannot be read at all (403, 404) shows nothing.
 */
export function HandoffCard({ detail, onOpen }: HandoffCardProps) {
  const { handoff, available } = useCaseHandoff(detail)
  const titleId = useId()
  if (!available || detail.case.status === 'closed') return null
  if (handoff.status === 'error' && !describeHandoffFailure(handoff.error).retry) return null

  let body: ReactNode
  let action: ReactNode = null
  let title = 'El asistente te pasó este caso'
  if (handoff.status === 'pending') {
    body = (
      <span aria-busy="true" className="flex flex-col gap-1.5">
        <span className="sr-only">Cargando el traspaso del asistente</span>
        <Skeleton className="h-4 w-64" />
      </span>
    )
  } else if (handoff.status === 'error') {
    const failure = describeHandoffFailure(handoff.error)
    title = failure.title
    body = <p className="m-0 text-13 text-ink-2">{failure.description}</p>
    action = (
      <Button
        variant="secondary"
        size="sm"
        loading={handoff.isFetching}
        icon={<RefreshCcw size={14} aria-hidden="true" />}
        onClick={() => void handoff.refetch()}
      >
        Reintentar
      </Button>
    )
  } else {
    const view = handoff.data
    body = (
      <>
        <p className="m-0 inline-flex items-start gap-1.5 text-13 text-ink-2">
          <Hand size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            <b className="font-semibold">Por qué te lo pasó: </b>
            {view.reason}
            {view.reasonDetail ? ` (${view.reasonDetail})` : null}
          </span>
        </p>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {view.priority ? <SeenPriority priority={view.priority} /> : null}
          {view.queue ? <SuggestedQueue queue={view.queue} /> : null}
          <span className="inline-flex items-center gap-1.5 text-13 text-ink-2">
            <Check size={14} aria-hidden="true" className="text-success" />
            {verifiedCountLabel(view.verified.length)}
          </span>
        </span>
      </>
    )
    action = (
      <Button
        variant="secondary"
        size="sm"
        iconEnd={<ArrowRight size={14} aria-hidden="true" />}
        aria-label="Ver todo el traspaso del asistente"
        onClick={onOpen}
      >
        Ver todo
      </Button>
    )
  }

  return (
    <div className="shrink-0 px-6 pt-3">
      <section
        aria-labelledby={titleId}
        className="mx-auto flex w-full max-w-[880px] items-start gap-3 rounded-12 border border-accent-border bg-surface px-3.5 py-3"
      >
        <AssistantAvatar />
        <div className="flex min-w-0 grow flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 id={titleId} className="m-0 text-14 font-semibold">
              {title}
            </h3>
            <TeamOnlyChip />
          </div>
          {body}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </section>
    </div>
  )
}

const CHIP: Record<'success' | 'warn' | 'accent' | 'neutral', string> = {
  success: 'bg-success-soft text-success-strong',
  warn: 'bg-warn-soft text-warn-strong',
  accent: 'bg-accent-soft text-accent-strong',
  neutral: 'bg-panel text-ink-2',
}

function HandoffSection({
  title,
  icon: Icon,
  tone,
  items,
  empty,
}: {
  title: string
  icon: LucideIcon
  tone: keyof typeof CHIP
  items: readonly HandoffItem[]
  empty: string
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3
        id={headingId}
        className="m-0 text-11 font-semibold tracking-[0.06em] text-muted uppercase"
      >
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="m-0 text-13 text-muted">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-14 leading-[1.4]">
              <span
                aria-hidden="true"
                className={cn(
                  'mt-px flex size-[22px] shrink-0 items-center justify-center rounded-[7px]',
                  CHIP[tone],
                )}
              >
                <Icon size={13} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="break-words">{item.text}</span>
                {item.detail ? <span className="text-12 text-muted">{item.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export interface HandoffPanelProps {
  detail: Pick<CaseDetail, 'case' | 'assignment'>
}

/**
 * The "Traspaso" tab of the right panel (IaWorkspace "iaTraspasoTodo", slice 19): why the
 * assistant handed the case over (with the priority it saw and the queue it suggested), what it
 * verified, what the customer said that nobody verified, what it did, what is still open, and
 * what the customer asked in its words. Read-only, staff-only, from `GET /cases/{id}/handoff`.
 */
export function HandoffPanel({ detail }: HandoffPanelProps) {
  const { handoff } = useCaseHandoff(detail)
  const reasonId = useId()
  const requestId = useId()
  if (handoff.status === 'pending') {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">Cargando el traspaso del asistente</span>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-56" />
      </div>
    )
  }
  if (handoff.status === 'error') {
    const failure = describeHandoffFailure(handoff.error)
    return (
      <Callout
        tone={failure.retry ? 'warn' : 'neutral'}
        title={failure.title}
        actions={
          failure.retry ? (
            <Button size="sm" loading={handoff.isFetching} onClick={() => void handoff.refetch()}>
              Reintentar
            </Button>
          ) : undefined
        }
      >
        {failure.description}
      </Callout>
    )
  }
  const view = handoff.data
  return (
    <>
      <h2 className="sr-only">Traspaso del asistente</h2>
      <div className="flex flex-wrap items-center gap-2">
        {view.priority ? <SeenPriority priority={view.priority} /> : null}
        {view.queue ? <SuggestedQueue queue={view.queue} /> : null}
        <TeamOnlyChip />
      </div>
      {view.degraded ? (
        <Callout tone="neutral" title="El traspaso llegó incompleto">
          El asistente no pudo armar todos los datos. Revisa la conversación.
        </Callout>
      ) : null}
      <section aria-labelledby={reasonId} className="flex flex-col gap-2">
        <h3
          id={reasonId}
          className="m-0 text-11 font-semibold tracking-[0.06em] text-muted uppercase"
        >
          Por qué te lo pasó
        </h3>
        <p className="m-0 flex items-start gap-2 text-14 leading-[1.4]">
          <Hand size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-2" />
          <span className="flex flex-col">
            <span>{view.reason}</span>
            {view.reasonDetail ? (
              <span className="text-12 text-muted">{view.reasonDetail}</span>
            ) : null}
          </span>
        </p>
      </section>
      <HandoffSection
        title="Verificado"
        icon={Check}
        tone="success"
        items={view.verified}
        empty={HANDOFF_EMPTY.verified}
      />
      <HandoffSection
        title="Dice el cliente, sin verificar"
        icon={CircleHelp}
        tone="warn"
        items={view.claimed}
        empty={HANDOFF_EMPTY.claimed}
      />
      <HandoffSection
        title="Lo que hizo el asistente"
        icon={Bot}
        tone="accent"
        items={view.actions}
        empty={HANDOFF_EMPTY.actions}
      />
      <HandoffSection
        title="Falta resolver"
        icon={List}
        tone="neutral"
        items={view.open}
        empty={HANDOFF_EMPTY.open}
      />
      <section aria-labelledby={requestId} className="flex flex-col gap-2">
        <h3
          id={requestId}
          className="m-0 text-11 font-semibold tracking-[0.06em] text-muted uppercase"
        >
          Qué pide
        </h3>
        <p className="m-0 text-14 leading-[1.45]">{view.summary ?? HANDOFF_EMPTY.summary}</p>
        {view.summary ? (
          <span className="inline-flex items-center gap-1.5 text-12 text-muted">
            <MessageCircle size={12} aria-hidden="true" />
            En palabras del asistente
          </span>
        ) : null}
      </section>
      <p className="m-0 border-t border-border-soft pt-3 text-12 text-muted">
        Lo armó el asistente virtual con su conversación. Revísalo antes de responder.
      </p>
    </>
  )
}
