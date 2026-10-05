import { CircleCheck, X } from 'lucide-react'
import { IconButton } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'

export interface ResultStripProps {
  /** `null` = nothing to report (the live region stays mounted, empty). */
  result: { message: string } | null
  onDismiss(): void
}

/**
 * The result line under the header after an action on the screen (a reassignment, an
 * answer, taking a case): a check and one sentence, dismissible. The status region
 * (`<output>`) is always mounted so the message is announced when it appears.
 */
export function ResultStrip({ result, onDismiss }: ResultStripProps) {
  const { t } = useTranslation('common')
  return (
    // <output> is a polite status live region, always mounted so the message is announced.
    <output className="block shrink-0">
      {result ? (
        <div className="flex items-center justify-between gap-4 border-b border-border bg-surface px-7 py-2.5">
          <p className="m-0 flex items-center gap-2 text-14">
            <CircleCheck size={16} aria-hidden="true" className="shrink-0 text-success" />
            <span>{result.message}</span>
          </p>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t('toast.dismiss')}
            icon={<X size={16} aria-hidden="true" />}
            onClick={onDismiss}
          />
        </div>
      ) : null}
    </output>
  )
}
