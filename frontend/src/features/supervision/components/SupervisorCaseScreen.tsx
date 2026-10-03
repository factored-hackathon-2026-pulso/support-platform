import { useCallback, useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import {
  Badge,
  Button,
  Callout,
  Dialog,
  DocumentTitle,
  LinkButton,
  Spinner,
  useToast,
} from '@/components/ui'
import {
  CaseHistorySheet,
  ConversationPane,
  shortCaseId,
  useCaseDetail,
} from '@/features/conversation'
import { useNow } from '@/lib/hooks'
import { assignedToastTitle, type CaseViewUrlState, type UrlStateChangeOptions } from '../model'
import { useQueueNotices, useTeamOverview } from '../hooks'
import type { CaseSummary } from '../types'
import { AssignCaseDialog } from './AssignCaseDialog'
import { TEAM_TICK_MS } from './TeamScreen'

export interface SupervisorCaseScreenProps {
  caseId: string
  state: CaseViewUrlState
  onStateChange(patch: Partial<CaseViewUrlState>, options?: UrlStateChangeOptions): void
  /** Where "Volver" goes: the screen the supervisor came from (filters included). */
  backTo: string
  /** "Volver a Equipo y colas" / "Volver a Auditoría". */
  backLabel: string
}

/**
 * The supervisor's read-only view of any case (contract §8.5): the Workspace
 * conversation in supervision mode (never a composer, a read cursor or "Cerrar
 * caso", even on her own case), "Casos anteriores", and "Asignar" / "Reasignar"
 * while the case is open. Opening it is audited by the server (`case.viewed`).
 */
export function SupervisorCaseScreen({
  caseId,
  state,
  onStateChange,
  backTo,
  backLabel,
}: SupervisorCaseScreenProps) {
  useQueueNotices()
  const detail = useCaseDetail(caseId)
  const { toast } = useToast()
  const now = useNow(TEAM_TICK_MS)
  const customerName = detail.data?.customer.displayName ?? null
  const summary = detail.data?.case
  const canAssign = detail.data?.capabilities.canAssign ?? false

  // ?asignar=1 on a case that cannot be assigned (closed, or not a supervisor any more).
  const cannotAssign = state.assign && detail.status === 'success' && !canAssign
  useEffect(() => {
    if (cannotAssign) onStateChange({ assign: false }, { replace: true })
  }, [cannotAssign, onStateChange])

  const openAssign = useCallback(() => onStateChange({ assign: true }), [onStateChange])
  const closeAssign = useCallback(
    () => onStateChange({ assign: false }, { replace: true }),
    [onStateChange],
  )

  const headerActions =
    summary && canAssign ? (
      summary.status === 'queued' ? (
        <Button variant="primary" onClick={openAssign}>
          Asignar
        </Button>
      ) : (
        <Button variant="secondary" onClick={openAssign}>
          Reasignar
        </Button>
      )
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
        <Badge tone="neutral">Vista de supervisión · solo lectura</Badge>
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

      {state.assign && summary && canAssign ? (
        <AssignLoader
          summary={summary}
          holderName={detail.data?.assignment?.analystName ?? null}
          now={now}
          onClose={closeAssign}
          onAssigned={(analystName) =>
            toast({ title: assignedToastTitle(summary.customer.displayName, analystName) })
          }
        />
      ) : null}
    </div>
  )
}

interface AssignLoaderProps {
  summary: CaseSummary
  holderName: string | null
  now: number
  onClose(): void
  onAssigned(analystName: string): void
}

/** The assign dialog once the team (the candidates) is loaded; loading and error inside a dialog. */
function AssignLoader({ summary, holderName, now, onClose, onAssigned }: AssignLoaderProps) {
  const team = useTeamOverview()
  if (team.data) {
    return (
      <AssignCaseDialog
        summary={summary}
        analysts={team.data.analysts}
        holderName={summary.status === 'queued' ? null : holderName}
        now={now}
        onClose={onClose}
        onAssigned={(_result, analyst) => onAssigned(analyst.name)}
      />
    )
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={summary.assignedAnalystId ? 'Reasignar caso' : 'Asignar caso'}
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
