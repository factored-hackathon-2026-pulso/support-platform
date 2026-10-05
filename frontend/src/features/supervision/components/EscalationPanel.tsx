import { useId, useRef, useState } from 'react'
import { ArrowRight, Info, X } from 'lucide-react'
import { useCurrentUser } from '@/app/session'
import {
  Button,
  Callout,
  Fact,
  FactList,
  IconButton,
  Skeleton,
  Status,
  Textarea,
} from '@/components/ui'
import { ESCALATION_STATE, MAX_ESCALATION_TEXT } from '@/features/cases'
import { shortCaseId, useCaseDetail } from '@/features/conversation'
import { formatRelativeTime, formatTime } from '@/lib/format'
import { useTranslation } from '@/lib/i18n'
import {
  describeEscalationFailure,
  escalatedAgo,
  escalationCaseFacts,
  escalationOutcomeTitle,
  escalationResultCopy,
  replyHelp,
  replyLabel,
  replyRequiredError,
  supervisionName,
} from '../model'
import { useLastTurns, useRespondEscalation, useTakeEscalatedCase, useTeamOverview } from '../hooks'
import type { EscalationItem, Turn } from '../types'
import { AnalystAvatar } from './AnalystAvatar'
import { CaseLink } from './CaseLink'
import { ReassignDialog } from './ReassignDialog'

export interface EscalationPanelProps {
  item: EscalationItem
  now: number
  /** `?reassign=1`: the reassign dialog is open. */
  reassigning: boolean
  onReassign(open: boolean): void
  onClose(): void
  onOpenCase(caseId: string): void
  onResult(result: { message: string }): void
}

/**
 * The selected escalation (SuEscalados): the motive with who escalated and when, what
 * supervision did (once attended), the case facts, its last messages (read-only, "Ver
 * caso completo") and, while open, Responder (a required note), Tomar el caso (only for
 * someone who also holds Analista and speaks its language) and Reasignar.
 */
export function EscalationPanel({
  item,
  now,
  reassigning,
  onReassign,
  onClose,
  onOpenCase,
  onResult,
}: EscalationPanelProps) {
  const { t } = useTranslation(['supervision', 'common'])
  const { escalation } = item
  const me = useCurrentUser()
  // Reading the case here is a supervision read: the server audits it (case.viewed).
  const detail = useCaseDetail(escalation.caseId)
  const turns = useLastTurns(escalation.caseId)
  const respond = useRespondEscalation(escalation.id)
  const take = useTakeEscalatedCase(escalation.id)
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState('')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const replyId = useId()
  const replyHelpId = useId()
  const replyErrorId = useId()
  const open = escalation.state === 'open'
  const outcome = escalationOutcomeTitle(escalation, me.id)
  const analystName = escalation.escalatedByName ?? t('someoneFromTeam')

  function fail(error: unknown) {
    setFailure(describeEscalationFailure(error, { caseLanguage: item.case.language }).message)
  }

  function sendReply() {
    const note = reply.trim()
    if (!note) {
      setReplyError(replyRequiredError())
      replyRef.current?.focus()
      return
    }
    setFailure(null)
    respond.mutate(note, {
      onSuccess: () => {
        setReplying(false)
        setReply('')
        onResult(
          escalationResultCopy('answered', {
            analystName,
            customerName: escalation.customerName,
          }),
        )
      },
      onError: fail,
    })
  }

  function takeCase() {
    setFailure(null)
    take.mutate(undefined, {
      onSuccess: () =>
        onResult(
          escalationResultCopy('taken', { analystName, customerName: escalation.customerName }),
        ),
      onError: fail,
    })
  }

  return (
    <aside
      aria-labelledby={titleId}
      className="flex min-h-0 flex-col overflow-hidden rounded-12 border border-border bg-surface"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border-soft px-5 pt-4 pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="m-0 truncate text-17 font-semibold">
            {escalation.customerName}
          </h2>
          <span className="flex items-center gap-3 text-13 text-ink-2">
            <span className="font-mono" title={escalation.caseId}>
              {shortCaseId(escalation.caseId)}
            </span>
            <Status {...ESCALATION_STATE[escalation.state]} />
          </span>
        </div>
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={t('common:actions.close')}
          icon={<X size={16} aria-hidden="true" />}
          onClick={onClose}
        />
      </div>

      <div className="flex min-h-0 grow flex-col gap-5 overflow-y-auto px-5 py-4">
        {failure ? (
          <Callout tone="danger" title={t('escalations.panel.failedTitle')}>
            {failure}
          </Callout>
        ) : null}

        <section aria-labelledby={`${titleId}-motive`} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3
              id={`${titleId}-motive`}
              className="m-0 text-12 font-semibold tracking-kicker text-muted uppercase"
            >
              {t('escalations.panel.motive')}
            </h3>
            <Fact icon="clock" text={escalatedAgo(escalation, now)} tone="muted" />
          </div>
          <div className="flex gap-2.5">
            <AnalystAvatar name={analystName} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-13 font-semibold">{analystName}</span>
              <p className="m-0 text-14 leading-[1.45] break-words whitespace-pre-line">
                {escalation.motive}
              </p>
            </div>
          </div>
        </section>

        {outcome ? (
          <div className="flex gap-2.5 rounded-10 bg-success-soft px-3 py-2.5">
            <AnalystAvatar name={escalation.resolvedByName ?? supervisionName()} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="text-13 font-semibold">{outcome}</span>
                {escalation.resolvedAt ? (
                  <Fact
                    icon="clock"
                    text={formatRelativeTime(escalation.resolvedAt, now)}
                    tone="muted"
                  />
                ) : null}
              </span>
              {escalation.note ? (
                <p className="m-0 text-14 break-words whitespace-pre-line">{escalation.note}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <section aria-labelledby={`${titleId}-case`} className="flex flex-col gap-2">
          <h3
            id={`${titleId}-case`}
            className="m-0 text-12 font-semibold tracking-kicker text-muted uppercase"
          >
            {t('escalations.panel.case')}
          </h3>
          <FactList
            size="md"
            items={escalationCaseFacts(
              {
                summary: item.case,
                holderName: item.assigneeName,
                customer: detail.data?.customer ?? null,
              },
              now,
            )}
            className="flex-col items-start gap-y-1.5"
          />
        </section>

        <section aria-labelledby={`${titleId}-turns`} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3
              id={`${titleId}-turns`}
              className="m-0 text-12 font-semibold tracking-kicker text-muted uppercase"
            >
              {t('escalations.panel.lastMessages')}
            </h3>
            <CaseLink
              caseId={escalation.caseId}
              onOpen={onOpenCase}
              className="text-13 font-medium"
            >
              <span className="inline-flex items-center gap-1">
                {t('escalations.panel.viewFullCase')}
                <ArrowRight size={13} aria-hidden="true" />
              </span>
            </CaseLink>
          </div>
          <LastTurns turns={turns.data?.items} loading={turns.status === 'pending'} />
        </section>

        {open && replying ? (
          <form
            aria-label={t('escalations.panel.replyTo', { name: analystName })}
            className="flex flex-col gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              sendReply()
            }}
          >
            <div className="flex items-center justify-between">
              <label htmlFor={replyId} className="text-14 font-semibold">
                {replyLabel(escalation)} <span aria-hidden="true">*</span>
              </label>
              <span className="text-12 text-muted tabular-nums">
                {reply.trim().length}/{MAX_ESCALATION_TEXT}
              </span>
            </div>
            <Textarea
              ref={replyRef}
              id={replyId}
              rows={4}
              maxLength={MAX_ESCALATION_TEXT}
              required
              value={reply}
              aria-invalid={replyError ? true : undefined}
              aria-describedby={[replyHelpId, replyError ? replyErrorId : null]
                .filter(Boolean)
                .join(' ')}
              onChange={(event) => {
                setReply(event.target.value)
                setReplyError(null)
              }}
            />
            {replyError ? (
              <span id={replyErrorId} className="text-13 font-medium text-danger-strong">
                {replyError}
              </span>
            ) : null}
            <span id={replyHelpId} className="flex items-center gap-1.5 text-12 text-muted">
              <Info size={13} aria-hidden="true" />
              {replyHelp(escalation)}
            </span>
          </form>
        ) : null}
      </div>

      {open ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-soft px-5 py-3">
          {replying ? (
            <>
              <Button variant="primary" loading={respond.isPending} onClick={sendReply}>
                {t('escalations.panel.send')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setReplying(false)
                  setReply('')
                  setReplyError(null)
                }}
              >
                {t('actions.cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                onClick={() => {
                  setReplying(true)
                  setFailure(null)
                  requestAnimationFrame(() => replyRef.current?.focus())
                }}
              >
                {t('escalations.panel.reply')}
              </Button>
              {item.canTake ? (
                <Button variant="secondary" loading={take.isPending} onClick={takeCase}>
                  {t('actions.take')}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => onReassign(true)}>
                {t('actions.reassign')}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {open && reassigning ? (
        <ReassignLoader
          item={item}
          onClose={() => onReassign(false)}
          onReassigned={(toName) =>
            onResult(
              escalationResultCopy('reassigned', {
                analystName,
                customerName: escalation.customerName,
                toName,
              }),
            )
          }
        />
      ) : null}
    </aside>
  )
}

function LastTurns({ turns, loading }: { turns: Turn[] | undefined; loading: boolean }) {
  const { t } = useTranslation('supervision')
  if (loading) return <Skeleton className="h-24 w-full" />
  const items = (turns ?? []).slice(-4)
  if (items.length === 0) {
    return <p className="m-0 text-13 text-muted">{t('escalations.panel.noMessages')}</p>
  }
  return (
    <ol
      aria-label={t('escalations.panel.lastMessagesOfCase')}
      className="m-0 flex list-none flex-col gap-2 p-0"
    >
      {items.map((turn) => {
        if (turn.kind !== 'message') {
          return (
            <li key={turn.id} className="text-12 text-muted italic">
              <span className="sr-only">
                {turn.audience === 'staff'
                  ? t('escalations.panel.internalNote')
                  : t('escalations.panel.notice')}{' '}
              </span>
              {turn.text}
            </li>
          )
        }
        const customer = turn.authorRole === 'customer'
        return (
          <li key={turn.id} className={customer ? 'self-start' : 'self-end'}>
            <div
              lang={turn.language}
              className={
                customer
                  ? 'max-w-[320px] rounded-12 bg-canvas px-3 py-2 text-13'
                  : 'max-w-[320px] rounded-12 bg-accent-soft px-3 py-2 text-13'
              }
            >
              {turn.text}
            </div>
            <span className="mt-0.5 flex gap-2 text-11 text-muted">
              {customer ? null : <span>{turn.authorName}</span>}
              <span>{formatTime(turn.createdAt)}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

interface ReassignLoaderProps {
  item: EscalationItem
  onClose(): void
  onReassigned(toName: string): void
}

/** The reassign dialog once the team (the candidates) is loaded. */
function ReassignLoader({ item, onClose, onReassigned }: ReassignLoaderProps) {
  const team = useTeamOverview()
  if (!team.data) return null
  return (
    <ReassignDialog
      summary={item.case}
      analysts={team.data.analysts}
      holderName={item.assigneeName}
      onClose={onClose}
      onReassigned={(_result, analyst) => onReassigned(analyst.name)}
    />
  )
}
