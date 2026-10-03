import { useId, useMemo, useRef, useState } from 'react'
import { Button, Callout, Checkbox, Dialog, RadioGroup, useToast } from '@/components/ui'
import {
  CONFIRM_PAUSED_ERROR,
  CONFIRM_PAUSED_LABEL,
  PICK_ANALYST_ERROR,
  assignCandidates,
  assignDialogSubtitle,
  assignDialogTitle,
  assignSubmitLabel,
  customerSeesCopy,
  describeAssignFailure,
  isReassignment,
  needsPauseConfirmation,
  pausedWarning,
  unchangedToastTitle,
} from '../model'
import { useRefetchAssignmentData, useSetAssignee } from '../hooks'
import type { AssignmentResult, CaseSummary, TeamAnalyst } from '../types'

export interface AssignCaseDialogProps {
  /** The case as the supervisor sees it now (cached overview or detail). */
  summary: CaseSummary
  /** The team overview's analysts (candidates). */
  analysts: readonly TeamAnalyst[]
  /** Who holds it now ("Lo atiende …"); null when queued. */
  holderName: string | null
  /** Clock of the screen (the queue wait in the subtitle). */
  now: number
  onClose(): void
  /** A real change (`changed: true`): the screen reports it (strip or toast). */
  onAssigned(result: AssignmentResult, analyst: TeamAnalyst): void
}

/**
 * "Asignar caso" / "Reasignar caso" (contract §8.6): who gets it (rule 3:
 * analysts who do not speak the case language are listed but disabled), the
 * pause confirmation for a paused or offline target, and what the customer
 * will see. Mounted only while open (`?asignar=`), so every opening starts clean.
 */
export function AssignCaseDialog({
  summary: liveSummary,
  analysts,
  holderName,
  now,
  onClose,
  onAssigned,
}: AssignCaseDialogProps) {
  const assign = useSetAssignee(liveSummary.id)
  const refetch = useRefetchAssignmentData(liveSummary.id)
  const { toast } = useToast()
  /**
   * The case as it was when "Asignar" was pressed, until the answer arrives. The
   * realtime refetch can show the new holder before the PUT returns; without this
   * the dialog would flip to "Reasignar caso · Lo atiende …" for that instant.
   */
  const [submitted, setSubmitted] = useState<{
    summary: CaseSummary
    holder: string | null
  } | null>(null)
  const summary = submitted?.summary ?? liveSummary
  const holder = submitted ? submitted.holder : holderName
  const [analystId, setAnalystId] = useState<string | null>(null)
  const [confirmPaused, setConfirmPaused] = useState(false)
  /** The server said "paused" although our row did not: ask for the confirmation anyway. */
  const [serverSaysPaused, setServerSaysPaused] = useState(false)
  const [errors, setErrors] = useState<{ analyst?: string; confirm?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const radiosRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const confirmErrorId = useId()

  const candidates = useMemo(() => assignCandidates(analysts, summary), [analysts, summary])
  const chosen = candidates.find((candidate) => candidate.value === analystId)?.analyst ?? null
  const askPause = chosen !== null && (needsPauseConfirmation(chosen) || serverSaysPaused)

  function choose(id: string) {
    setAnalystId(id)
    setConfirmPaused(false)
    setServerSaysPaused(false)
    setErrors({})
    setFailure(null)
  }

  function submit() {
    if (!chosen) {
      setErrors({ analyst: PICK_ANALYST_ERROR })
      radiosRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:enabled')?.focus()
      return
    }
    if (askPause && !confirmPaused) {
      setErrors({ confirm: CONFIRM_PAUSED_ERROR })
      confirmRef.current?.focus()
      return
    }
    setFailure(null)
    setSubmitted({ summary, holder })
    assign.mutate(
      {
        analystId: chosen.id,
        expectedAnalystId: summary.assignedAnalystId,
        confirmPaused: askPause && confirmPaused,
      },
      {
        onSuccess: (result) => {
          if (!result.changed) {
            toast({ title: unchangedToastTitle(chosen.name), duration: 4000 })
          } else {
            onAssigned(result, chosen)
          }
          onClose()
        },
        onError: (error) => {
          // Back to the live case: a race may have moved it (`assignment_changed`).
          setSubmitted(null)
          const described = describeAssignFailure(error, {
            caseLanguage: summary.language,
            analystName: chosen.name,
          })
          switch (described.action) {
            case 'close':
              refetch()
              toast({ title: described.message, duration: 4000 })
              onClose()
              return
            case 'confirm_paused':
              setServerSaysPaused(true)
              // The checkbox renders on the next commit; focus it then.
              requestAnimationFrame(() => confirmRef.current?.focus())
              break
            case 'refetch':
              refetch()
              break
            case 'refetch_team':
              refetch('team')
              break
            default:
              break
          }
          setFailure(described.message)
        },
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={assignDialogTitle(summary)}
      description={assignDialogSubtitle(summary, holder, now)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={assign.isPending} onClick={submit}>
            {assignSubmitLabel(summary, chosen)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {failure ? (
          <Callout
            tone="danger"
            title={isReassignment(summary) ? 'No se reasignó' : 'No se asignó'}
          >
            {failure}
          </Callout>
        ) : null}
        <div ref={radiosRef}>
          {candidates.length === 0 ? (
            <p className="m-0 text-14 text-muted">No hay otras personas en el equipo.</p>
          ) : (
            <RadioGroup
              label="¿A quién?"
              required
              value={analystId}
              onValueChange={choose}
              error={errors.analyst}
              options={candidates.map(({ value, label, description, disabled }) => ({
                value,
                label,
                description,
                disabled,
              }))}
            />
          )}
        </div>
        {chosen && askPause ? (
          <div className="flex flex-col gap-2">
            <Callout tone="warn" icon>
              {pausedWarning(chosen)}
            </Callout>
            <Checkbox
              ref={confirmRef}
              label={CONFIRM_PAUSED_LABEL}
              checked={confirmPaused}
              required
              aria-invalid={errors.confirm ? true : undefined}
              aria-describedby={errors.confirm ? confirmErrorId : undefined}
              onChange={(event) => {
                setConfirmPaused(event.target.checked)
                setErrors({})
              }}
            />
            {errors.confirm ? (
              <span id={confirmErrorId} className="text-13 font-medium text-danger-strong">
                {errors.confirm}
              </span>
            ) : null}
          </div>
        ) : null}
        {chosen ? (
          <Callout tone="neutral" title="El cliente verá">
            {isReassignment(summary) ? (
              <span lang={summary.language}>{customerSeesCopy(summary, chosen)}</span>
            ) : (
              customerSeesCopy(summary, chosen)
            )}
          </Callout>
        ) : null}
      </div>
    </Dialog>
  )
}
