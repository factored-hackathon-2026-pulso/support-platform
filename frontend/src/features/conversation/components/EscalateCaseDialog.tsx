import { useRef, useState } from 'react'
import { CircleArrowUp, Users, WandSparkles } from 'lucide-react'
import { Button, Callout, Dialog, Field, Textarea, useToast } from '@/components/ui'
import { MAX_ESCALATION_TEXT } from '@/features/cases'
import { describeEscalationFailure, motiveCounter, shortCaseId, validateMotive } from '../model'
import { useEscalateCase } from '../hooks/use-escalation'
import type { CaseSummary } from '../types'

/** Slice 20: the copilot's recommendation the dialog opened from (its motive draft). */
export interface EscalationDialogPrefill {
  suggestionId: string
  motive: string
}

export interface EscalateCaseDialogProps {
  summary: CaseSummary
  open: boolean
  onOpenChange(open: boolean): void
  /**
   * Opened through the copilot's recommendation: the motive starts with its draft, the dialog
   * says it was suggested, and the escalation carries `copilotSuggestionId`.
   */
  suggestion?: EscalationDialogPrefill | null
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
 * Slice 20: opened from the copilot's recommendation, the motive is filled in with its draft
 * (she confirms or edits it) and the escalation carries `copilotSuggestionId`.
 */
export function EscalateCaseDialog({
  summary,
  open,
  onOpenChange,
  suggestion = null,
}: EscalateCaseDialogProps) {
  const escalate = useEscalateCase(summary.id)
  const { toast } = useToast()
  const [motive, setMotive] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(newKey)
  const motiveRef = useRef<HTMLTextAreaElement>(null)
  /** The recommendation whose draft filled the motive in this opening. */
  const [suggestedBy, setSuggestedBy] = useState<string | null>(null)
  if (open && suggestion && suggestedBy !== suggestion.suggestionId) {
    setSuggestedBy(suggestion.suggestionId)
    setMotive(suggestion.motive.slice(0, MAX_ESCALATION_TEXT))
    setError(null)
  }

  function changeOpen(next: boolean) {
    if (!next) {
      setMotive('')
      setError(null)
      setKey(newKey())
      setSuggestedBy(null)
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
      { motive: motive.trim(), idempotencyKey: key, copilotSuggestionId: suggestedBy },
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
        {suggestedBy ? (
          <p className="m-0 inline-flex items-center gap-1.5 text-13 text-accent-strong">
            <WandSparkles size={14} aria-hidden="true" />
            El copiloto sugirió este motivo. Revísalo antes de escalar.
          </p>
        ) : null}
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
