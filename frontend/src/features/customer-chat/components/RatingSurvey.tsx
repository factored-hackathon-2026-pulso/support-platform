import { useId, useRef, useState, type FormEvent } from 'react'
import { FACT_ICONS } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  RATING_COMMENT_MAX_LENGTH,
  describeRatingFailure,
  ratedThanks,
  ratingOptions,
  ratingSurveyCopy,
  toRatingRequest,
  type CustomerRatingOption,
  type CustomerRatingScore,
} from '../model'
import type { CaseRating, Language } from '../types'

/** Picked card colors per score (written out for Tailwind). */
const PICKED: Record<CustomerRatingOption['tone'], string> = {
  danger: 'border-2 border-danger-strong bg-danger-soft text-danger-strong',
  warn: 'border-2 border-warn-strong bg-warn-soft text-warn-strong',
  good: 'border-2 border-app-rate-ink bg-app-rate-good text-app-rate-ink',
  great: 'border-2 border-app-rate-ink bg-app-rate-great text-app-rate-ink',
}

export interface RatingSurveyProps {
  caseId: string
  agentName: string | null
  language: Language
  sending: boolean
  error: unknown
  onSend(input: {
    caseId: string
    score: CustomerRatingScore
    comment: string | null
    idempotencyKey: string
  }): void
  onSkip(caseId: string): void
}

/**
 * The satisfaction survey of a closed conversation (slice 7, Main.dc.html "cerrado"): it
 * takes the composer's place. "¿Cómo te atendió Daniela?", four face cards (native radios,
 * one Tab stop, arrows pick), an optional comment once a face is picked, "Ahora no" and
 * "Enviar" (aria-disabled until a face is picked). Everything in the customer's language.
 */
export function RatingSurvey({
  caseId,
  agentName,
  language,
  sending,
  error,
  onSend,
  onSkip,
}: RatingSurveyProps) {
  const copy = ratingSurveyCopy(agentName, language)
  const ids = useId()
  const [score, setScore] = useState<CustomerRatingScore | null>(null)
  const [comment, setComment] = useState('')
  const [hint, setHint] = useState(false)
  // One key per survey: retrying the same answer is a replay, never a second rating.
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const firstRadio = useRef<HTMLInputElement>(null)
  const titleId = `${ids}-title`
  const errorId = `${ids}-error`

  function submit(event: FormEvent) {
    event.preventDefault()
    if (sending) return
    if (!score) {
      setHint(true)
      firstRadio.current?.focus()
      return
    }
    onSend({ caseId, ...toRatingRequest(score, comment), idempotencyKey })
  }

  const failure = error ? describeRatingFailure(error, language) : null
  const message = failure ?? (hint && !score ? copy.pickFirst : null)

  return (
    <form
      onSubmit={submit}
      aria-labelledby={titleId}
      aria-describedby={message ? errorId : undefined}
      className="flex shrink-0 flex-col gap-3 border-t border-app-line bg-white px-5 pt-4 pb-6"
    >
      <span id={titleId} className="text-16 font-bold text-app-ink">
        {copy.title}
      </span>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">{copy.legend}</legend>
        <div className="grid grid-cols-4 gap-2">
          {ratingOptions(language).map((option, index) => {
            const Icon = FACT_ICONS[option.icon]
            const picked = score === option.score
            return (
              <label
                key={option.score}
                className={cn(
                  'flex min-h-[76px] cursor-pointer flex-col items-center justify-center gap-1 rounded-12 px-1 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                  picked
                    ? PICKED[option.tone]
                    : 'border border-app-line bg-white text-app-muted hover:border-app-chip-line',
                )}
              >
                <input
                  ref={index === 0 ? firstRadio : undefined}
                  type="radio"
                  name={`${ids}-score`}
                  value={option.score}
                  checked={picked}
                  onChange={() => {
                    setScore(option.score)
                    setHint(false)
                  }}
                  className="sr-only"
                />
                <Icon size={28} strokeWidth={1.8} aria-hidden="true" />
                <span className="text-13 font-semibold">{option.label}</span>
              </label>
            )
          })}
        </div>
      </fieldset>
      {score ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-comment`} className="text-13 font-semibold text-app-ink">
            {copy.commentLabel}
          </label>
          <textarea
            id={`${ids}-comment`}
            rows={2}
            maxLength={RATING_COMMENT_MAX_LENGTH}
            placeholder={copy.commentPlaceholder}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            className="resize-none rounded-12 border border-app-chip-line px-3 py-2.5 text-14 text-app-ink placeholder:text-app-muted"
          />
        </div>
      ) : null}
      {message ? (
        <p id={errorId} role="alert" className="m-0 text-13 text-danger">
          {message}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onSkip(caseId)}
          className="min-h-10 cursor-pointer rounded-8 border-0 bg-transparent px-2 text-14 font-semibold text-app-muted hover:text-app-ink"
        >
          {copy.skip}
        </button>
        <button
          type="submit"
          aria-disabled={!score || sending || undefined}
          aria-busy={sending || undefined}
          className="min-h-11 cursor-pointer rounded-full border-0 bg-app-brand px-5 text-15 font-semibold text-white hover:bg-app-brand-strong aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {copy.send}
        </button>
      </div>
    </form>
  )
}

/** "¡Gracias! Calificaste: Excelente" with the face, after the rating (Main.dc.html "calificado"). */
export function RatedPill({ rating, language }: { rating: CaseRating; language: Language }) {
  const option = ratingOptions(language)[Math.min(4, Math.max(1, rating.score)) - 1]
  const Icon = FACT_ICONS[option?.icon ?? 'smile']
  return (
    <span className="inline-flex items-center gap-2 self-center rounded-full bg-app-rate-good px-3.5 py-2 text-13 font-semibold text-app-rate-ink">
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      {ratedThanks(rating, language)}
    </span>
  )
}
