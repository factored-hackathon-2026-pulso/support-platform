import { arrivalLine } from '../model'
import type { CaseDetail } from '../types'

export interface ArrivalNoteProps {
  detail: Pick<CaseDetail, 'assignment' | 'case'>
  meId: string
}

/**
 * "Cómo llegó a ti" (contract §9.3): one muted line under the header that
 * explains the people-based assignment only (available + language, or the
 * queue wait). Nothing while the case has no assignment.
 */
export function ArrivalNote({ detail, meId }: ArrivalNoteProps) {
  const line = arrivalLine(detail, meId)
  if (!line) return null
  return (
    <p className="m-0 shrink-0 border-b border-border bg-subtle px-6 py-2 text-12 text-muted">
      <span className="font-semibold text-ink-2">Cómo llegó a ti</span>
      <span aria-hidden="true"> · </span>
      <span className="sr-only">: </span>
      {line}
    </p>
  )
}
