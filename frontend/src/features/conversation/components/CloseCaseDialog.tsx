import { useState } from 'react'
import { Button, Callout, Checkbox, Dialog, Field, SegmentedControl, Select } from '@/components/ui'
import {
  CONTACT_REASON_OPTIONS,
  describeCloseFailure,
  FOLLOW_UP_OPTIONS,
  INITIAL_CLOSE_FORM,
  RESOLUTION_OPTIONS,
  toCloseRequest,
  validateCloseForm,
  type CloseCaseForm,
  type CloseFormErrors,
} from '../model'
import { useCloseCase } from '../hooks/use-close-case'
import type { CaseSummary, ContactReason, FollowUp, ResolutionCode } from '../types'

export interface CloseCaseDialogProps {
  summary: CaseSummary
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed?: (caseId: string) => void
}

type ResultValue = 'resolved' | 'unresolved'

const RESULT_OPTIONS = [
  { value: 'resolved', label: 'Resuelto' },
  { value: 'unresolved', label: 'Sin resolver' },
] as const satisfies ReadonlyArray<{ value: ResultValue; label: string }>

/**
 * "Cerrar caso" (canvas `cerrar`): result, contact reason, follow-up, what was
 * done and the satisfaction survey. Saved in the platform history (`case_close`).
 */
export function CloseCaseDialog({ summary, open, onOpenChange, onClosed }: CloseCaseDialogProps) {
  const close = useCloseCase(summary.id)
  const [form, setForm] = useState<CloseCaseForm>(INITIAL_CLOSE_FORM)
  const [errors, setErrors] = useState<CloseFormErrors>({})

  function update(patch: Partial<CloseCaseForm>) {
    setForm((current) => ({ ...current, ...patch }))
    if ('resolved' in patch) setErrors((current) => ({ ...current, resolved: undefined }))
  }

  function changeOpen(next: boolean) {
    if (!next) {
      setForm(INITIAL_CLOSE_FORM)
      setErrors({})
      close.reset()
    }
    onOpenChange(next)
  }

  function submit() {
    const found = validateCloseForm(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    close.mutate(toCloseRequest(form), {
      onSuccess: () => {
        changeOpen(false)
        onClosed?.(summary.id)
      },
    })
  }

  const result: ResultValue | '' =
    form.resolved === null ? '' : form.resolved ? 'resolved' : 'unresolved'

  return (
    <Dialog
      open={open}
      onOpenChange={changeOpen}
      title="Cerrar caso"
      description={
        <>
          {summary.customer.displayName} · <span className="font-mono text-12">{summary.id}</span>
        </>
      }
      footerNote="Se guarda en el histórico de la plataforma"
      footer={
        <>
          <Button variant="secondary" onClick={() => changeOpen(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={close.isPending} onClick={submit}>
            Cerrar caso
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <span className="text-13 font-semibold" aria-hidden="true">
            Resultado
          </span>
          <SegmentedControl<ResultValue>
            label="Resultado"
            options={RESULT_OPTIONS}
            value={result as ResultValue}
            onValueChange={(value) => update({ resolved: value === 'resolved' })}
          />
          {errors.resolved ? (
            <span className="text-13 font-medium text-danger-strong" role="alert">
              {errors.resolved}
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Motivo del contacto">
            <Select
              options={CONTACT_REASON_OPTIONS}
              value={form.contactReason}
              onChange={(event) => update({ contactReason: event.target.value as ContactReason })}
            />
          </Field>
          <Field label="Seguimiento">
            <Select
              options={FOLLOW_UP_OPTIONS}
              value={form.followUp}
              onChange={(event) => update({ followUp: event.target.value as FollowUp })}
            />
          </Field>
        </div>
        <Field label="Qué se hizo">
          <Select
            options={RESOLUTION_OPTIONS}
            placeholder="Elige una opción"
            value={form.resolutionCode}
            onChange={(event) =>
              update({ resolutionCode: event.target.value as ResolutionCode | '' })
            }
          />
        </Field>
        <Checkbox
          label="Enviarle la encuesta de satisfacción al cerrar"
          checked={form.sendCsatSurvey}
          onChange={(event) => update({ sendCsatSurvey: event.target.checked })}
        />
        {close.isError ? (
          <Callout tone="danger" title="No se cerró el caso">
            {describeCloseFailure(close.error)}
          </Callout>
        ) : null}
      </div>
    </Dialog>
  )
}
