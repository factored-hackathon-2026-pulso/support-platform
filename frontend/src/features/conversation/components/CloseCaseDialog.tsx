import { useRef, useState } from 'react'
import { Button, Callout, Dialog, Field, RadioGroup, Textarea } from '@/components/ui'
import { CLOSE_REASONS, CloseReasonIcon, type CloseReason } from '@/features/cases'
import {
  CLOSED_NOTICE,
  CLOSE_NOTE_MAX_LENGTH,
  INITIAL_CLOSE_FORM,
  describeCloseFailure,
  noteCounter,
  shortCaseId,
  toCloseRequest,
  validateCloseForm,
  type CloseCaseForm,
  type CloseFormErrors,
} from '../model'
import { closeNoticeChannel } from '../channels'
import { useCloseCase } from '../hooks/use-close-case'
import type { CaseSummary } from '../types'

/** The reason cards: label, meaning, tone and icon from the one reason map (cases). */
const REASON_CARDS = CLOSE_REASONS.map((reason) => ({
  value: reason.value,
  label: reason.label,
  description: reason.meaning,
  tone: reason.tone,
  icon: <CloseReasonIcon reason={reason.value} size="md" />,
  wide: reason.value === 'other',
}))

export interface CloseCaseDialogProps {
  summary: CaseSummary
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed?: (caseId: string) => void
}

/**
 * "Cerrar caso" (contract §9.5): a required reason from the fixed list (slice 6:
 * a two-column grid of cards with the reason's icon, tone and meaning), an
 * optional internal note (≤ 500 characters, only staff see it) and a preview
 * of the notice the customer will get, in the case language. The customer never
 * sees the reason or the note.
 */
export function CloseCaseDialog({ summary, open, onOpenChange, onClosed }: CloseCaseDialogProps) {
  const close = useCloseCase(summary.id)
  const [form, setForm] = useState<CloseCaseForm>(INITIAL_CLOSE_FORM)
  const [errors, setErrors] = useState<CloseFormErrors>({})
  const reasonsRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const noteTooLong = form.note.trim().length > CLOSE_NOTE_MAX_LENGTH
  // Slice 12: a call has no screen to show the notice on; an email case gets it by email.
  const noticeChannel = closeNoticeChannel(summary)

  function update(patch: Partial<CloseCaseForm>) {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch) as (keyof CloseCaseForm)[]) delete next[key]
      return next
    })
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
    // A failed validation focuses the first invalid control (its error is its description).
    if (found.reason) {
      reasonsRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus()
      return
    }
    if (found.note || form.reason === null) {
      noteRef.current?.focus()
      return
    }
    close.mutate(toCloseRequest({ ...form, reason: form.reason }), {
      onSuccess: () => {
        changeOpen(false)
        onClosed?.(summary.id)
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={changeOpen}
      title="Cerrar caso"
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
          <Button variant="primary" loading={close.isPending} onClick={submit}>
            Cerrar caso
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div ref={reasonsRef}>
          <RadioGroup<CloseReason>
            label="Motivo"
            required
            variant="cards"
            columns={2}
            options={REASON_CARDS}
            value={form.reason}
            error={errors.reason}
            onValueChange={(reason) => update({ reason })}
          />
        </div>
        <Field
          label="Nota interna (opcional)"
          hint="Solo la ve el equipo."
          error={
            errors.note ?? (noteTooLong ? 'La nota puede tener hasta 500 caracteres.' : undefined)
          }
          labelAside={
            <span className={noteTooLong ? 'text-12 text-danger-strong' : 'text-12 text-muted'}>
              {noteCounter(form.note)}
            </span>
          }
        >
          <Textarea
            ref={noteRef}
            rows={3}
            value={form.note}
            onChange={(event) => update({ note: event.target.value })}
          />
        </Field>
        {noticeChannel === 'call' ? null : (
          <Callout
            tone="neutral"
            title={
              noticeChannel === 'email' ? 'El cliente lo recibe por correo' : 'El cliente verá'
            }
          >
            <span lang={summary.language}>{CLOSED_NOTICE[summary.language]}</span>
          </Callout>
        )}
        {close.isError ? (
          <Callout tone="danger" title="No se cerró el caso">
            {describeCloseFailure(close.error)}
          </Callout>
        ) : null}
      </div>
    </Dialog>
  )
}
