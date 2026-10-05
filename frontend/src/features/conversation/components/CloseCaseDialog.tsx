import { useId, useRef, useState } from 'react'
import { CircleMinus, Puzzle, ThumbsUp } from 'lucide-react'
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
import {
  HANDOFF_QUALITY_OPTIONS,
  toggleHandoffQuality,
  type HandoffQualityOption,
} from '../handoff'
import { useCaseHandoff } from '../hooks/use-handoff'
import { useCloseCase } from '../hooks/use-close-case'
import type { CaseDetail, CaseSummary, HandoffQuality } from '../types'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'

/**
 * The reason cards: label, meaning, tone and icon from the one reason map (cases). Built when
 * the dialog renders, so the words follow the UI language.
 */
function reasonCards() {
  return CLOSE_REASONS.map((reason) => ({
    value: reason.value,
    label: reason.label,
    description: reason.meaning,
    tone: reason.tone,
    icon: <CloseReasonIcon reason={reason.value} size="md" />,
    wide: reason.value === 'other',
  }))
}

export interface CloseCaseDialogProps {
  summary: CaseSummary
  /** Slice 19: how the case reached her (a handoff of the assistant asks how useful it was). */
  assignment?: CaseDetail['assignment']
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed?: (caseId: string) => void
}

/**
 * "Cerrar caso" (contract §9.5): a required reason from the fixed list (slice 6:
 * a two-column grid of cards with the reason's icon, tone and meaning), an
 * optional internal note (≤ 500 characters, only staff see it) and a preview
 * of the notice the customer will get, in the case language. The customer never
 * sees the reason or the note. Slice 19: for a case the assistant handed over (AI on, and only
 * once its handoff loaded) the optional "¿Te sirvió el traspaso del asistente?" (Útil,
 * Incompleto, Innecesario), sent as `handoffQuality` only when answered.
 */
export function CloseCaseDialog({
  summary,
  assignment = null,
  open,
  onOpenChange,
  onClosed,
}: CloseCaseDialogProps) {
  // `cases` too: the reason cards are the shared case vocabulary.
  const { t } = useTranslation(['conversation', 'cases'])
  const close = useCloseCase(summary.id)
  const { handoff } = useCaseHandoff({ case: summary, assignment })
  const asksHandoff = handoff.status === 'success'
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
    const request = toCloseRequest({
      ...form,
      reason: form.reason,
      // Never sent for a handoff that did not load (the question was not on screen).
      handoffQuality: asksHandoff ? form.handoffQuality : null,
    })
    close.mutate(request, {
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
      title={t('close.title')}
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
            {t('actions.cancel')}
          </Button>
          <Button variant="primary" loading={close.isPending} onClick={submit}>
            {t('close.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div ref={reasonsRef}>
          <RadioGroup<CloseReason>
            label={t('close.reason')}
            required
            variant="cards"
            columns={2}
            options={reasonCards()}
            value={form.reason}
            error={errors.reason}
            onValueChange={(reason) => update({ reason })}
          />
        </div>
        <Field
          label={t('close.note')}
          hint={t('close.noteHint')}
          error={errors.note ?? (noteTooLong ? t('close.noteTooLong') : undefined)}
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
        {asksHandoff ? (
          <HandoffQualityField
            value={form.handoffQuality}
            onChange={(handoffQuality) => update({ handoffQuality })}
          />
        ) : null}
        {noticeChannel === 'call' ? null : (
          <Callout
            tone="neutral"
            title={noticeChannel === 'email' ? t('close.noticeByEmail') : t('close.noticeOnScreen')}
          >
            <span lang={summary.language}>{CLOSED_NOTICE[summary.language]}</span>
          </Callout>
        )}
        {close.isError ? (
          <Callout tone="danger" title={t('close.failedTitle')}>
            {describeCloseFailure(close.error)}
          </Callout>
        ) : null}
      </div>
    </Dialog>
  )
}

const QUALITY_ICON: Record<HandoffQualityOption['icon'], typeof ThumbsUp> = {
  'thumbs-up': ThumbsUp,
  puzzle: Puzzle,
  'circle-minus': CircleMinus,
}

const QUALITY_TONE: Record<HandoffQualityOption['tone'], { chip: string; picked: string }> = {
  success: {
    chip: 'bg-success-soft text-success-strong',
    picked: 'border-2 border-success-strong bg-success-soft',
  },
  warn: {
    chip: 'bg-warn-soft text-warn-strong',
    picked: 'border-2 border-warn-strong bg-warn-soft',
  },
  neutral: { chip: 'bg-panel text-ink-2', picked: 'border-2 border-ink-2 bg-panel' },
}

/**
 * "¿Te sirvió el traspaso del asistente? (opcional)" (IaAnCerrar): three toggle cards, at most
 * one picked; picking the picked one again clears it.
 */
function HandoffQualityField({
  value,
  onChange,
}: {
  value: HandoffQuality | null
  onChange(value: HandoffQuality | null): void
}) {
  const { t } = useTranslation('conversation')
  const hintId = useId()
  return (
    <fieldset aria-describedby={hintId} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-14 font-semibold">
        {t('handoff.quality.legend')}{' '}
        <span className="font-normal text-muted">{t('close.optional')}</span>
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {HANDOFF_QUALITY_OPTIONS.map((option) => {
          const Icon = QUALITY_ICON[option.icon]
          const picked = value === option.value
          const tone = QUALITY_TONE[option.tone]
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={picked}
              onClick={() => onChange(toggleHandoffQuality(value, option.value))}
              className={cn(
                'flex min-h-14 cursor-pointer items-start gap-2.5 rounded-12 px-2.5 py-2 text-left',
                picked ? tone.picked : 'border border-border bg-surface hover:border-ink-2',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-[30px] shrink-0 items-center justify-center rounded-[9px]',
                  tone.chip,
                )}
              >
                <Icon size={16} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-14 font-semibold text-ink">{option.label}</span>
                <span className="text-12 leading-[1.3] text-ink-2">{option.description}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p id={hintId} className="m-0 text-12 text-muted">
        {t('handoff.quality.hint')}
      </p>
    </fieldset>
  )
}
