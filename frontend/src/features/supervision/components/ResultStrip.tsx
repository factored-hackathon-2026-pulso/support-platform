import { X } from 'lucide-react'
import { IconButton } from '@/components/ui'

export interface ResultStripProps {
  /** `null` = nothing to report (the live region stays mounted, empty). */
  result: { prefix: string; message: string } | null
  onDismiss(): void
}

/**
 * The canvas "Listo ·" line under the header, shown after an action on the
 * team screen only (contract §8.4). The status region (`<output>`) is always
 * mounted so the message is announced when it appears; no "Siguiente paso" recommendation.
 */
export function ResultStrip({ result, onDismiss }: ResultStripProps) {
  return (
    // <output> is a polite status live region, always mounted so the message is announced.
    <output className="block shrink-0">
      {result ? (
        <div className="flex items-center justify-between gap-4 border-b border-border bg-surface px-7 py-2.5">
          <p className="m-0 text-14">
            <span className="font-semibold text-success">{result.prefix}</span> {result.message}
          </p>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Cerrar aviso"
            icon={<X size={16} aria-hidden="true" />}
            onClick={onDismiss}
          />
        </div>
      ) : null}
    </output>
  )
}
