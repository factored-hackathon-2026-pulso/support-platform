import { Lock } from 'lucide-react'
import { Fact } from '@/components/ui'
import { type CaseRating, CloseReasonIcon, RatingBadge, closeReasonLabel } from '@/features/cases'
import { footerFacts, ratingComment, supervisionFooter, type ConversationMode } from '../model'
import type { CaseDetail } from '../types'

export interface ReadOnlyFooterProps {
  detail: Pick<CaseDetail, 'capabilities' | 'closure' | 'assignment' | 'case'>
  meId: string
  /** `supervision`: "Solo lectura: …" / "Sin asignar: …" (slice 3 §8.3, slice 9), whatever the capabilities say. */
  mode?: ConversationMode
}

const frame =
  'flex items-start gap-2.5 rounded-10 border border-border bg-panel px-3.5 py-3 text-14 text-ink-2'

/**
 * Replaces the composer when the viewer cannot write (contract §9.3). In the
 * Workspace (slice 6 UI rule) it is short facts: a closed case shows its reason
 * (icon + label, the same as in Cerrados and the close dialog), when it closed
 * and who closed it when it was someone else, then the internal note on its own
 * line, then (slice 7) the customer's rating as a pill with its face and one word
 * ("Bien"; screen readers hear "Calificación del cliente: Bien") and their comment in quotes; someone else's case shows [lock]
 * Solo lectura and [user] Lo atiende … . The supervisor view keeps its lines.
 */
export function ReadOnlyFooter({ detail, meId, mode = 'workspace' }: ReadOnlyFooterProps) {
  if (mode === 'supervision') {
    const lines = supervisionFooter(detail, meId)
    if (!lines) return null
    const [first, ...rest] = lines
    return (
      <div role="note" aria-label="Solo lectura" className={frame}>
        {detail.closure ? (
          <CloseReasonIcon reason={detail.closure.reason} className="mt-px" />
        ) : (
          <Lock size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="m-0 font-semibold text-ink">{first}</p>
          {rest.map((line) => (
            <p key={line} className="m-0 break-words whitespace-pre-line">
              {line}
            </p>
          ))}
        </div>
      </div>
    )
  }
  const footer = footerFacts(detail, meId)
  if (!footer) return null
  return (
    <div role="note" aria-label="Solo lectura" className={frame}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {footer.reason ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <CloseReasonIcon reason={footer.reason} />
              {closeReasonLabel(footer.reason)}
            </span>
          ) : null}
          {footer.facts.map(({ key, ...fact }) => (
            <Fact key={key} {...fact} size="md" />
          ))}
        </div>
        {footer.note ? <p className="m-0 break-words whitespace-pre-line">{footer.note}</p> : null}
        {footer.rating ? <RatingLine rating={footer.rating} /> : null}
      </div>
    </div>
  )
}

function RatingLine({ rating }: { rating: CaseRating }) {
  const comment = ratingComment(rating)
  return (
    <p className="m-0 mt-1 flex flex-wrap items-center gap-2">
      <RatingBadge rating={rating} srLabel="Calificación del cliente" />
      {comment ? <span className="text-13 break-words text-ink-2">{comment}</span> : null}
    </p>
  )
}
