import { PanelLeftOpen } from 'lucide-react'
import { IconButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { getInitials } from '@/lib/format'
import { inboxStatusMeta } from '../model'
import type { CaseSummary } from '../types'
import { toneRing } from './tone-classes'

export interface CollapsedCaseRailProps {
  items: readonly CaseSummary[] | undefined
  /** Cases waiting for the analyst's answer (orange number on top). */
  toReplyCount: number | undefined
  selectedCaseId: string | null
  onSelectCase: (caseId: string) => void
  onExpand: () => void
}

/** Collapsed list (`?list=collapsed`, canvas state `contraida`): 64px rail with the cases as round initials (ring = status). */
export function CollapsedCaseRail({
  items,
  toReplyCount,
  selectedCaseId,
  onSelectCase,
  onExpand,
}: CollapsedCaseRailProps) {
  return (
    <section
      aria-label="Casos, lista contraída"
      className="flex h-full w-16 shrink-0 flex-col items-center gap-2.5 border-r border-border bg-panel py-4"
    >
      <h1 className="sr-only">Casos</h1>
      <IconButton
        aria-label="Mostrar la lista de casos"
        title="Mostrar casos"
        icon={<PanelLeftOpen size={18} />}
        className="rounded-8"
        onClick={onExpand}
      />
      {toReplyCount !== undefined ? (
        <span className="text-12 font-semibold text-warn tabular">
          {toReplyCount}
          <span className="sr-only"> por responder</span>
        </span>
      ) : null}
      <ul className="m-0 flex min-h-0 scrollbar-thin list-none flex-col items-center gap-2.5 overflow-y-auto p-1">
        {(items ?? []).map((summary) => {
          const meta = inboxStatusMeta(summary)
          const name = summary.customer.displayName
          const selected = summary.id === selectedCaseId
          return (
            <li key={summary.id}>
              <button
                type="button"
                aria-label={`${name}, ${meta.subLabel}`}
                aria-current={selected || undefined}
                title={`${name} (${meta.subLabel})`}
                onClick={() => onSelectCase(summary.id)}
                className={cn(
                  'flex size-10 cursor-pointer items-center justify-center rounded-full border-[3px] text-13 font-semibold text-ink',
                  toneRing[meta.tone],
                  selected ? 'bg-surface' : 'bg-transparent hover:bg-subtle',
                )}
              >
                {getInitials(name)}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
