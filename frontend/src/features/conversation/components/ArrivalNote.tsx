import { Fact } from '@/components/ui'
import { arrivalFacts, supervisionArrivalLine, type ConversationMode } from '../model'
import type { CaseDetail } from '../types'

export interface ArrivalNoteProps {
  detail: Pick<CaseDetail, 'assignment' | 'case'>
  meId: string
  /** `supervision`: the line describes who holds the case, not how it reached the viewer. */
  mode?: ConversationMode
}

/**
 * The arrival note under the case header: the people-based assignment only.
 * In the Workspace (slice 6 UI rule) it is one row of short facts — the heading
 * ("Cómo llegó a ti", or "Quién lo atiende" for someone else's case), each fact
 * an icon + 1–3 words ([check] Estabas disponible, [languages] Hablas portugués
 * "Regla 3"…) and the time with a clock; never a sentence. The supervisor view
 * (slice 3 §8.3) keeps its "Cómo llegó" line, with the time as a separate clock fact (slice
 * 9: no " · " joins). Nothing while there is nothing to
 * explain.
 */
export function ArrivalNote({ detail, meId, mode = 'workspace' }: ArrivalNoteProps) {
  if (mode === 'supervision') {
    const arrival = supervisionArrivalLine(detail)
    if (!arrival) return null
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-subtle px-6 py-2 text-12 text-muted">
        <p className="m-0">
          <span className="font-semibold text-ink-2">Cómo llegó</span>
          <span className="sr-only">: </span> {arrival.line}
        </p>
        {arrival.time ? (
          <Fact
            icon="clock"
            text={arrival.time}
            label="Asignado"
            tone="muted"
            className="ml-auto"
          />
        ) : null}
      </div>
    )
  }
  const arrival = arrivalFacts(detail, meId)
  if (!arrival) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-subtle px-6 py-2">
      <span className="text-12 font-semibold text-ink-2">{arrival.heading}</span>
      <ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0">
        {arrival.facts.map(({ key, ...fact }) => (
          <li key={key} className="flex">
            <Fact {...fact} />
          </li>
        ))}
      </ul>
      {arrival.time ? (
        <Fact icon="clock" text={arrival.time} label="Asignado" tone="muted" className="ml-auto" />
      ) : null}
    </div>
  )
}
