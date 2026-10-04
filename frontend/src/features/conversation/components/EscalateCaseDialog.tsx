import { useRef, useState } from 'react'
import { CircleArrowUp, Users } from 'lucide-react'
import { Button, Callout, Dialog, Field, Textarea, useToast } from '@/components/ui'
import { MAX_ESCALATION_TEXT } from '@/features/cases'
import { describeEscalationFailure, motiveCounter, shortCaseId, validateMotive } from '../model'
import { useEscalateCase } from '../hooks/use-escalation'
import type { CaseSummary } from '../types'

export interface EscalateCaseDialogProps {
  summary: CaseSummary
  open: boolean
  onOpenChange(open: boolean): void
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `esc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * "Escalar a supervisión" (Workspace.dc.html "escalar", slice 9): a required motive
 * (≤ 500, counter), seen by the team only, and the reminder that the case stays with her.
 * One `Idempotency-Key` per opening: a retry after a lost answer replays the escalation.
 */
export function EscalateCaseDialog({ summary, open, onOpenChange }: EscalateCaseDialogProps) {
  const escalate = useEscalateCase(summary.id)
  const { toast } = useToast()
  const [motive, setMotive] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(newKey)
  const motiveRef = useRef<HTMLTextAreaElement>(null)

  function changeOpen(next: boolean) {
    if (!next) {
      setMotive('')
      setError(null)
      setKey(newKey())
      escalate.reset()
    }
    onOpenChange(next)
  }

  function submit() {
    const invalid = validateMotive(motive)
    setError(invalid)
    if (invalid) {
      motiveRef.current?.focus()
      return
    }
    escalate.mutate(
      { motive: motive.trim(), idempotencyKey: key },
      {
        onSuccess: () => {
          changeOpen(false)
          toast({ title: 'Escalaste el caso a supervisión', duration: 4000 })
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={changeOpen}
      title="Escalar a supervisión"
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <span>{summary.customer.displayName}</span>
          <span className="font-mono text-12" title={summary.id}>
            {shortCaseId(summary.id)}
          </span>
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => changeOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={escalate.isPending}
            icon={<CircleArrowUp size={15} aria-hidden="true" />}
            onClick={submit}
          >
            Escalar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Motivo"
          required
          error={error ?? undefined}
          hint={
            <span className="inline-flex items-center gap-1">
              <Users size={13} aria-hidden="true" />
              Lo ve el equipo. El cliente no.
            </span>
          }
          labelAside={<span className="text-12 text-muted">{motiveCounter(motive)}</span>}
        >
          <Textarea
            ref={motiveRef}
            rows={4}
            maxLength={MAX_ESCALATION_TEXT}
            placeholder="Qué necesitas de supervisión"
            value={motive}
            onChange={(event) => {
              setMotive(event.target.value)
              setError(null)
            }}
          />
        </Field>
        <Callout tone="info" title="El caso sigue contigo">
          Puedes seguir escribiéndole al cliente mientras supervisión responde.
        </Callout>
        {escalate.isError ? (
          <Callout tone="danger" title="No se escaló el caso">
            {describeEscalationFailure(escalate.error, 'escalate')}
          </Callout>
        ) : null}
      </div>
    </Dialog>
  )
}
