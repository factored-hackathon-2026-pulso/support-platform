import { Lock } from 'lucide-react'
import { readOnlyFooter, supervisionFooter, type ConversationMode } from '../model'
import type { CaseDetail } from '../types'

export interface ReadOnlyFooterProps {
  detail: Pick<CaseDetail, 'capabilities' | 'closure' | 'assignment' | 'case'>
  meId: string
  /** `supervision`: "Vista de supervisión · …" (slice 3 §8.3), whatever the capabilities say. */
  mode?: ConversationMode
}

/**
 * Replaces the composer when the viewer cannot write (contract §9.3): a closed
 * case shows "Caso cerrado el … · {motivo}" (+ "Nota: …"); someone else's case
 * (history access) shows "Solo lectura: este caso es de {nombre}."; the
 * supervisor view says what the case waits for or who holds it.
 */
export function ReadOnlyFooter({ detail, meId, mode = 'workspace' }: ReadOnlyFooterProps) {
  const lines =
    mode === 'supervision' ? supervisionFooter(detail, meId) : readOnlyFooter(detail, meId)
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
