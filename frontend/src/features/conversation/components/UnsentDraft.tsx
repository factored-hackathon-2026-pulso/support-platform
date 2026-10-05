import { Button, Callout } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'

export interface UnsentDraftProps {
  text: string
  onDiscard(): void
}

/**
 * What the analyst was writing when she lost the right to reply (supervision
 * reassigned the case, or it closed meanwhile). The composer goes away; the
 * text stays on screen, selectable, until she discards it, so it is never lost
 * silently.
 */
export function UnsentDraft({ text, onDiscard }: UnsentDraftProps) {
  const { t } = useTranslation('conversation')
  return (
    <div role="note" aria-label={t('unsentDraft.label')}>
      <Callout
        tone="warn"
        title={t('unsentDraft.title')}
        actions={
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            {t('unsentDraft.discard')}
          </Button>
        }
      >
        <p className="m-0">{t('unsentDraft.text')}</p>
        <p className="m-0 mt-1.5 max-h-24 scrollbar-thin overflow-y-auto rounded-8 bg-surface px-2.5 py-2 break-words whitespace-pre-wrap text-ink">
          {text}
        </p>
      </Callout>
    </div>
  )
}
