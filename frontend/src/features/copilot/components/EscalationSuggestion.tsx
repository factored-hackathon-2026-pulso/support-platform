import { useState } from 'react'
import { CircleArrowUp, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui'
import { escalationReason, suggestionView } from '../model'
import { useLatestSuggestion } from '../hooks/use-suggestions'

export interface EscalationPrefill {
  suggestionId: string
  motive: string
}

export interface EscalationSuggestionProps {
  caseId: string
  /** AI on, her open case, and she may escalate it (no escalation open). */
  enabled: boolean
  /** "Revisar y escalar": the pane opens "Escalar a supervisión" with the motive filled in. */
  onReview(prefill: EscalationPrefill): void
}

/**
 * The copilot recommends escalating (slice 20; ADR 0005 §3-4: from agent-core's rules, with its
 * reason and evidence so she can disagree). It only recommends: "Revisar y escalar" opens the
 * usual dialog with `motiveDraft` filled in, and she confirms or edits; the escalation then
 * carries `copilotSuggestionId`. "Ahora no" hides it for this suggestion (there is no feedback
 * for it in the API).
 */
export function EscalationSuggestion({ caseId, enabled, onReview }: EscalationSuggestionProps) {
  const latest = useLatestSuggestion(caseId, enabled)
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)
  if (!enabled) return null
  const view = suggestionView(latest.data)
  const escalation = view?.escalation
  if (!view || !escalation || hiddenFor === view.id) return null

  return (
    <div className="shrink-0 px-6 pt-3">
      <section
        aria-label="El copiloto recomienda escalar"
        className="mx-auto flex w-full max-w-[880px] flex-col gap-2 rounded-12 border border-warn-border bg-warn-soft px-3.5 py-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="inline-flex items-center gap-1.5 text-14 font-semibold text-warn-strong">
              <CircleArrowUp size={15} aria-hidden="true" />
              El copiloto recomienda escalar a supervisión
            </span>
            <span className="text-13 text-ink-2">{escalationReason(escalation.reasonCode)}</span>
          </div>
          <span className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setHiddenFor(view.id)}>
              Ahora no
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onReview({ suggestionId: view.id, motive: escalation.motiveDraft })}
            >
              Revisar y escalar
            </Button>
          </span>
        </div>
        {escalation.evidence.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1.5 text-12 font-semibold text-ink-2">
              <ListChecks size={13} aria-hidden="true" />
              En qué se basa
            </span>
            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-13 text-ink">
              {escalation.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  )
}
