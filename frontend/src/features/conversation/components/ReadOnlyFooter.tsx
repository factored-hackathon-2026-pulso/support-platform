import { Lock } from 'lucide-react'
import { readOnlyFooter } from '../model'
import type { CaseDetail } from '../types'

export interface ReadOnlyFooterProps {
  detail: Pick<CaseDetail, 'capabilities' | 'closure' | 'assignment'>
  meId: string
}

/**
 * Replaces the composer when the viewer cannot write (contract §9.3): a closed
 * case shows "Caso cerrado el … · {motivo}" (+ "Nota: …"); someone else's case
 * (history access, supervisor) shows "Solo lectura: este caso es de {nombre}."
 */
export function ReadOnlyFooter({ detail, meId }: ReadOnlyFooterProps) {
  const lines = readOnlyFooter(detail, meId)
  if (!lines) return null
  const [first, ...rest] = lines
  return (
    <div
      role="note"
      aria-label="Solo lectura"
      className="flex items-start gap-2.5 rounded-10 border border-border bg-panel px-3.5 py-3 text-14 text-ink-2"
    >
      <Lock size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
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
