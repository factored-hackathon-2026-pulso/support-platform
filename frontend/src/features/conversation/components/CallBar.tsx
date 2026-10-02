import { useNow } from '@/features/cases'
import { cn } from '@/lib/cn'
import { callBarState } from '../model'
import type { CaseDetail } from '../types'

const TONES = {
  success: { bar: 'bg-success-soft', dot: 'bg-success' },
  callout: { bar: 'bg-callout-soft', dot: 'bg-callout' },
  neutral: { bar: 'bg-subtle', dot: 'bg-offline' },
} as const

/**
 * Call bar (canvas `llamada` / `saliente`), layout seam: state, timer and how the
 * call came in. Hold, mute and hang up arrive with functional calls.
 */
export function CallBar({ detail }: { detail: CaseDetail }) {
  const live = detail.case.status === 'in_call'
  const now = useNow(1000, live)
  const bar = callBarState(detail, now)
  const tone = TONES[bar.tone]
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2.5 border-b border-border px-6 py-2.5 text-14',
        tone.bar,
      )}
    >
      <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-full', tone.dot)} />
      <span className="font-semibold">{bar.state}</span>
      {bar.timer ? (
        <span className="font-mono text-13 tabular" aria-label={`Duración ${bar.timer}`}>
          {bar.timer}
        </span>
      ) : null}
      <span className="min-w-0 truncate text-ink-2">{bar.kind}</span>
    </div>
  )
}
