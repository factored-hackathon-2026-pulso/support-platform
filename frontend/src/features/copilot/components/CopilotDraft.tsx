import { History, Pencil, Send, Trash2, WandSparkles } from 'lucide-react'
import { Button, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import { suggestionView } from '../model'
import { useDiscardDraft, useLatestSuggestion, useReportShown } from '../hooks/use-suggestions'

/** How the draft went into the composer: as it is ("Usar") or to change it ("Editar"). */
export type DraftTakeMode = 'use' | 'edit'

export interface TakenDraft {
  suggestionId: string
  mode: DraftTakeMode
}

export interface CopilotDraftProps {
  caseId: string
  /** AI on, her open case, the chat composer showing, and the type's mode allows drafts. */
  enabled: boolean
  /** The draft already in the composer (the bar then gives way to a line). */
  taken: TakenDraft | null
  /** "Usar" / "Editar": the pane puts the text in the composer and remembers the id. */
  onTake(text: string, taken: TakenDraft): void
}

/**
 * The copilot's draft above the composer (slice 20, IaWorkspace "et3"): the newest `reply`
 * suggestion with "Descartar" (feedback `discarded`), "Editar" and "Usar". Both put the text in
 * the composer and she sends it: nothing is ever sent for her; the reply then carries
 * `copilotSuggestionId` and the backend derives `used` or `edited`. While it is in the composer a
 * line says so; while a suggestion is being prepared, a quiet status line.
 */
export function CopilotDraft({ caseId, enabled, taken, onTake }: CopilotDraftProps) {
  const { t } = useTranslation('copilot')
  const latest = useLatestSuggestion(caseId, enabled)
  const discard = useDiscardDraft(caseId)
  const view = suggestionView(latest.data)
  useReportShown(caseId, view, enabled && !taken && Boolean(view?.reply))
  if (!enabled) return null

  if (taken) {
    return (
      <p className="m-0 inline-flex items-center gap-1.5 text-12 font-semibold text-accent-strong">
        <Pencil size={13} aria-hidden="true" />
        {taken.mode === 'edit' ? t('draft.editing') : t('draft.inComposer')}
      </p>
    )
  }
  if (view?.status === 'preparing') {
    return (
      <output className="inline-flex items-center gap-2 text-12 text-muted">
        <Spinner size={13} label={null} />
        {t('draft.preparing')}
      </output>
    )
  }
  const reply = view?.reply
  if (!view || !reply) return null

  return (
    <section
      aria-label={t('draft.title')}
      className={cn(
        'flex flex-col gap-2 rounded-14 border border-accent-border bg-assistant-bubble px-3.5 py-3',
        view.stale && 'opacity-80',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-13 font-semibold text-accent-strong">
          <WandSparkles size={14} aria-hidden="true" />
          {t('draft.title')}
        </span>
        <span className="text-12 text-ink-2">{t('draft.review')}</span>
      </div>
      <p className="m-0 text-15 leading-[1.45] whitespace-pre-wrap text-ink">{reply.text}</p>
      {view.stale ? (
        <p className="m-0 inline-flex items-center gap-1.5 text-12 text-ink-2">
          <History size={13} aria-hidden="true" />
          {t('draft.stale')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-12 text-ink-2">{t('draft.basis')}</span>
        <span className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Trash2 size={14} aria-hidden="true" />}
            onClick={() => discard.mutate(view.id)}
          >
            {t('draft.discard')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Pencil size={14} aria-hidden="true" />}
            onClick={() => onTake(reply.text, { suggestionId: view.id, mode: 'edit' })}
          >
            {t('draft.edit')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            iconEnd={<Send size={14} aria-hidden="true" />}
            title={t('draft.useHint')}
            onClick={() => onTake(reply.text, { suggestionId: view.id, mode: 'use' })}
          >
            {t('draft.use')}
          </Button>
        </span>
      </div>
    </section>
  )
}
