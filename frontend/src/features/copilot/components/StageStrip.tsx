import { Bot, Tag } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import { stageStrip, type CaseTypeStage } from '../stages'

export interface StageStripProps {
  /** The case type in words ("Cobro indebido"). */
  typeLabel: string
  stage: CaseTypeStage
}

/**
 * The stage strip under the case header (IaWorkspace, slice 21): the case type, three stage bars
 * and one quiet line saying what the copilot does for this type. The bars are decoration; the
 * line carries the stage for everyone.
 *
 * With the support panel open the conversation is about 600 px wide at 1440 px: the type name
 * never wraps or shrinks, and the line wraps under itself (aligned with its first line) instead of
 * being cut, so the whole sentence is always readable.
 */
export function StageStrip({ typeLabel, stage }: StageStripProps) {
  const { t } = useTranslation('copilot')
  const view = stageStrip(stage)
  return (
    <div
      data-testid="stage-strip"
      className="flex shrink-0 items-start gap-2.5 border-b border-border bg-subtle px-6 py-[7px] text-13 leading-[19px] text-ink-2"
    >
      <span
        data-testid="stage-strip-type"
        className="inline-flex shrink-0 items-center gap-[5px] font-semibold whitespace-nowrap text-ink"
      >
        <Tag size={13} aria-hidden="true" className="shrink-0" />
        <span className="sr-only">{t('stage.typeLabel')} </span>
        {typeLabel}
      </span>
      <span aria-hidden="true" className="inline-flex h-[19px] shrink-0 items-center gap-0.5">
        {view.bars.map((filled, index) => (
          <span
            key={index}
            data-filled={filled || undefined}
            className={cn('h-1 w-3 rounded-[2px]', filled ? 'bg-accent-strong' : 'bg-border')}
          />
        ))}
      </span>
      {view.agent ? (
        <span aria-hidden="true" className="inline-flex h-[19px] shrink-0 items-center">
          <Bot size={13} className="text-accent-strong" />
        </span>
      ) : null}
      <span data-testid="stage-strip-line" className="min-w-0 flex-1 text-pretty">
        {view.line}
      </span>
    </div>
  )
}
