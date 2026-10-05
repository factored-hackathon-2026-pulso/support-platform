import { Bot, Tag } from 'lucide-react'
import { cn } from '@/lib/cn'
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
 */
export function StageStrip({ typeLabel, stage }: StageStripProps) {
  const view = stageStrip(stage)
  return (
    <div
      data-testid="stage-strip"
      className="flex shrink-0 items-center gap-2.5 border-b border-border bg-subtle px-6 py-[7px] text-13 text-ink-2"
    >
      <span className="inline-flex items-center gap-[5px] font-semibold text-ink">
        <Tag size={13} aria-hidden="true" className="shrink-0" />
        <span className="sr-only">Tipo de caso: </span>
        {typeLabel}
      </span>
      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
        {view.bars.map((filled, index) => (
          <span
            key={index}
            data-filled={filled || undefined}
            className={cn('h-1 w-3 rounded-[2px]', filled ? 'bg-accent-strong' : 'bg-border')}
          />
        ))}
      </span>
      {view.agent ? (
        <Bot size={13} aria-hidden="true" className="shrink-0 text-accent-strong" />
      ) : null}
      <span className="min-w-0 truncate">{view.line}</span>
    </div>
  )
}
