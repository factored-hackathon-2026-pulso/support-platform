import { useRef, useState } from 'react'
import { PhoneOutgoing, Users } from 'lucide-react'
import { Button, Callout, Dialog, Field, Textarea } from '@/components/ui'
import { MAX_CALL_REASON, describeCallFailure, validateCallReason } from '../channels'
import { useStartCall } from '../hooks'
import { shortCaseId } from '../model'
import type { CaseSummary } from '../types'

export interface StartCallDialogProps {
  summary: CaseSummary
  open: boolean
  onOpenChange(open: boolean): void
}

function newKey(): string {
  return crypto.randomUUID()
}

/**
 * "Llamar al cliente" (slice 12): the assignee calls the customer on an open case, with a
 * required reason (≤ 500, staff only, shown as "Por qué llamas" during the call). One
 * `Idempotency-Key` per opening: a retry after a lost answer replays the same call.
 */
export function StartCallDialog({ summary, open, onOpenChange }: StartCallDialogProps) {
  const start = useStartCall(summary.id)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(newKey)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  function changeOpen(next: boolean) {
    if (!next) {
      setReason('')
      setError(null)
      setKey(newKey())
      start.reset()
    }
    onOpenChange(next)
  }

  function submit() {
    const invalid = validateCallReason(reason)
    setError(invalid)
    if (invalid) {
      reasonRef.current?.focus()
      return
    }
    start.mutate({ reason: reason.trim(), key }, { onSuccess: () => changeOpen(false) })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={changeOpen}
      title="Llamar al cliente"
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
            loading={start.isPending}
            icon={<PhoneOutgoing size={15} aria-hidden="true" />}
            onClick={submit}
          >
            Llamar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Por qué llamas"
          required
          error={error ?? undefined}
          hint={
            <span className="inline-flex items-center gap-1">
              <Users size={13} aria-hidden="true" />
              Lo ve el equipo. El cliente no.
            </span>
          }
          labelAside={
            <span className="text-12 text-muted">
              {reason.trim().length}/{MAX_CALL_REASON}
            </span>
          }
        >
          <Textarea
            ref={reasonRef}
            rows={3}
            maxLength={MAX_CALL_REASON}
            placeholder="Qué quieres resolver en la llamada"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value)
              setError(null)
            }}
          />
        </Field>
        {start.isError ? (
          <Callout tone="danger" title="No se hizo la llamada">
            {describeCallFailure(start.error)}
          </Callout>
        ) : null}
      </div>
    </Dialog>
  )
}
