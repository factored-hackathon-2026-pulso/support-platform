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
  ConversationPane,
  shortCaseId,
  useCaseDetail,
} from '@/features/conversation'
import { reassignedToastTitle, type CaseViewUrlState, type UrlStateChangeOptions } from '../model'
import { useTeamOverview } from '../hooks'
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
  const detail = useCaseDetail(caseId)
  const { toast } = useToast()
  const customerName = detail.data?.customer.displayName ?? null
  const summary = detail.data?.case
  const held = summary !== undefined && summary.status !== 'queued' && summary.status !== 'closed'
  const canReassign = held && (detail.data?.capabilities.canAssign ?? false)

  // ?reasignar=1 on a case that cannot be reassigned (queued, closed, not a supervisor).
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
  // reads it on a closed one (glyph + word).
  const headerActions = detail.data ? (
    <>
      {summary?.escalated ? <Status {...ESCALATED_MARKER} className="mr-1" /> : null}
      <CasePriorityControl detail={detail.data} align="end" className="mr-1" />
      {canReassign ? (
        <Button variant="secondary" onClick={openReassign}>
          Reasignar
        </Button>
      ) : null}
    </>
  ) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DocumentTitle title={`Caso ${shortCaseId(caseId)} · Supervisión`} />
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
          Solo lectura
        </span>
        <h1 className="sr-only">
          {customerName
            ? `Conversación de ${customerName} (supervisión)`
            : 'Conversación (supervisión)'}
        </h1>
      </div>
      <main className="flex min-h-0 grow flex-col bg-canvas">
        <ConversationPane
          caseId={caseId}
          mode="supervision"
          headerActions={headerActions}
          onOpenHistory={() => onStateChange({ history: 'lista' })}
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
      title="Reasignar caso"
    >
      {team.status === 'error' ? (
        <Callout
          tone="danger"
          title="No pudimos cargar el equipo"
          actions={
            <Button size="sm" loading={team.isFetching} onClick={() => void team.refetch()}>
              Reintentar
            </Button>
          }
        >
          Revisa tu conexión e inténtalo de nuevo.
        </Callout>
      ) : (
        <div className="flex justify-center py-6 text-muted">
          <Spinner label="Cargando el equipo" size={24} />
        </div>
      )}
    </Dialog>
  )
}
