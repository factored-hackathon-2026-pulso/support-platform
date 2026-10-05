import { useCallback, useEffect } from 'react'
import { ArrowLeft, Eye } from 'lucide-react'
import {
  Button,
  Callout,
  Dialog,
  DocumentTitle,
  LinkButton,
  Spinner,
  Status,
  useToast,
} from '@/components/ui'
import { ESCALATED_MARKER } from '@/features/cases'
import {
  CaseHistorySheet,
  CasePriorityControl,
  CaseTypeControl,
  ConversationPane,
  PREVIOUS_CASES_LIST,
  shortCaseId,
  useCaseDetail,
} from '@/features/conversation'
import { useTranslation } from '@/lib/i18n'
import { describeReleaseFailure, reassignedToastTitle, takenFromAssistantToast } from '../model'
import type { CaseViewUrlState, UrlStateChangeOptions } from '../url'
import { useReleaseFromAssistant, useTeamOverview } from '../hooks'
import type { CaseSummary } from '../types'
import { ReassignDialog } from './ReassignDialog'

export interface SupervisorCaseScreenProps {
  caseId: string
  state: CaseViewUrlState
  onStateChange(patch: Partial<CaseViewUrlState>, options?: UrlStateChangeOptions): void
  /** Where "Volver" goes: the screen the supervisor came from (filters included). */
  backTo: string
  /** "Volver a Colas" / "Volver a Equipo" / "Volver a Escalados" / "Volver a Auditoría". */
  backLabel: string
}

/**
 * The supervisor's read-only view of any case (SuCaso.dc.html): the Workspace conversation
 * in supervision mode (never a composer, a read cursor or "Cerrar caso", even on her own
 * case), "Casos anteriores", the "Escalado" marker, the priority menu (slice 8) and
 * "Reasignar" while someone holds it (the exception: assignment is automatic, so a case
 * nobody holds explains that instead of offering a button). Opening it is audited by the
 * server (`case.viewed`).
 */
export function SupervisorCaseScreen({
  caseId,
  state,
  onStateChange,
  backTo,
  backLabel,
}: SupervisorCaseScreenProps) {
  const { t } = useTranslation('supervision')
  const detail = useCaseDetail(caseId)
  const { toast } = useToast()
  const customerName = detail.data?.customer.displayName ?? null
  const summary = detail.data?.case
  // Slice 19: a case the assistant holds is taken ("Tomar el caso"), never reassigned.
  const withAssistant = summary?.status === 'with_assistant'
  const held =
    summary !== undefined &&
    summary.status !== 'queued' &&
    summary.status !== 'closed' &&
    !withAssistant
  const canReassign = held && (detail.data?.capabilities.canAssign ?? false)
  const release = useReleaseFromAssistant(caseId)

  // ?reassign=1 on a case that cannot be reassigned (queued, closed, not a supervisor).
  const cannotReassign = state.reassign && detail.status === 'success' && !canReassign
  useEffect(() => {
    if (cannotReassign) onStateChange({ reassign: false }, { replace: true })
  }, [cannotReassign, onStateChange])

  const openReassign = useCallback(() => onStateChange({ reassign: true }), [onStateChange])
  const closeReassign = useCallback(
    () => onStateChange({ reassign: false }, { replace: true }),
    [onStateChange],
  )

  // Slice 8: supervision sets the priority of any open case from here (the menu), and
  // reads it on a closed one (glyph + word). Slice 18: the case type, likewise, only while
  // the AI switch is on (the control renders nothing otherwise).
  const headerActions = detail.data ? (
    <>
      {summary?.escalated ? <Status {...ESCALATED_MARKER} className="mr-1" /> : null}
      <CaseTypeControl detail={detail.data} align="end" className="mr-1" />
      <CasePriorityControl detail={detail.data} align="end" className="mr-1" />
      {canReassign ? (
        <Button variant="secondary" onClick={openReassign}>
          {t('actions.reassign')}
        </Button>
      ) : null}
      {withAssistant ? (
        <Button
          variant="secondary"
          loading={release.isPending}
          onClick={() =>
            release.mutate(undefined, {
              onSuccess: (taken) => toast(takenFromAssistantToast(taken)),
              onError: (error) => toast({ ...describeReleaseFailure(error), politeness: 'alert' }),
            })
          }
        >
          {t('actions.take')}
        </Button>
      ) : null}
    </>
  ) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DocumentTitle title={t('caseView.documentTitle', { id: shortCaseId(caseId) })} />
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-6 py-2">
        <LinkButton
          to={backTo}
          variant="ghost"
          size="sm"
          icon={<ArrowLeft size={14} aria-hidden="true" />}
        >
          {backLabel}
        </LinkButton>
        <span className="inline-flex items-center gap-1.5 text-13 text-ink-2">
          <Eye size={14} aria-hidden="true" className="text-muted" />
          {t('caseView.readOnly')}
        </span>
        <h1 className="sr-only">
          {customerName
            ? t('caseView.heading', { name: customerName })
            : t('caseView.headingAnonymous')}
        </h1>
      </div>
      <main className="flex min-h-0 grow flex-col bg-canvas">
        <ConversationPane
          caseId={caseId}
          mode="supervision"
          headerActions={headerActions}
          onOpenHistory={() => onStateChange({ history: PREVIOUS_CASES_LIST })}
        />
      </main>

      {state.history ? (
        <CaseHistorySheet
          caseId={caseId}
          customerName={customerName ?? ''}
          selected={state.history}
          onSelect={(history) => onStateChange({ history }, { replace: true })}
          onClose={() => onStateChange({ history: null })}
        />
      ) : null}

      {state.reassign && summary && canReassign ? (
        <ReassignLoader
          summary={summary}
          holderName={detail.data?.assignment?.analystName ?? null}
          onClose={closeReassign}
          onReassigned={(analystName) =>
            toast({ title: reassignedToastTitle(summary.customer.displayName, analystName) })
          }
        />
      ) : null}
    </div>
  )
}

interface ReassignLoaderProps {
  summary: CaseSummary
  holderName: string | null
  onClose(): void
  onReassigned(analystName: string): void
}

/** The reassign dialog once the team (the candidates) is loaded; loading and error inside a dialog. */
function ReassignLoader({ summary, holderName, onClose, onReassigned }: ReassignLoaderProps) {
  const { t } = useTranslation(['supervision', 'common'])
  const team = useTeamOverview()
  if (team.data) {
    return (
      <ReassignDialog
        summary={summary}
        analysts={team.data.analysts}
        holderName={holderName}
        onClose={onClose}
        onReassigned={(_result, analyst) => onReassigned(analyst.name)}
      />
    )
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('reassign.title')}
    >
      {team.status === 'error' ? (
        <Callout
          tone="danger"
          title={t('caseView.teamLoadError')}
          actions={
            <Button size="sm" loading={team.isFetching} onClick={() => void team.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {t('common:query.errorDescription')}
        </Callout>
      ) : (
        <div className="flex justify-center py-6 text-muted">
          <Spinner label={t('caseView.loadingTeam')} size={24} />
        </div>
      )}
    </Dialog>
  )
}
