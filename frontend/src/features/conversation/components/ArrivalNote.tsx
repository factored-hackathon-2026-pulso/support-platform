import { arrivalNote, supervisionArrivalLine, type ConversationMode } from '../model'
import type { CaseDetail } from '../types'

export interface ArrivalNoteProps {
  detail: Pick<CaseDetail, 'assignment' | 'case'>
  meId: string
  /** `supervision`: the line describes who holds the case, not how it reached the viewer. */
  mode?: ConversationMode
}

/**
 * The arrival note (contract §9.3): one muted line under the header that
 * explains the people-based assignment only (available + language, the queue
 * wait, or a supervisor's choice). "Cómo llegó a ti" for the assignee; "Quién
 * lo atiende" / "Quién lo atendió" when someone else holds the case (history
 * access, or supervision moved it away from the viewer). In the supervisor view
 * (slice 3 §8.3) it is "Cómo llegó": who holds the case and why, or the queue it
 * waits in. Nothing while there is nothing to explain.
 */
export function ArrivalNote({ detail, meId, mode = 'workspace' }: ArrivalNoteProps) {
  const note =
    mode === 'supervision'
      ? withHeading('Cómo llegó', supervisionArrivalLine(detail))
      : arrivalNote(detail, meId)
  if (!note) return null
  return (
    <p className="m-0 shrink-0 border-b border-border bg-subtle px-6 py-2 text-12 text-muted">
      <span className="font-semibold text-ink-2">{note.heading}</span>
      <span aria-hidden="true"> · </span>
      <span className="sr-only">: </span>
      {note.line}
    </p>
  )
}

function withHeading(heading: string, line: string | null) {
  return line ? { heading, line } : null
}
