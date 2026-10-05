/**
 * Pure rules of the Workspace screen: which case to show and the empty-state copy (the
 * URL state is in url.ts). No React, no I/O: unit-tested in model.test.ts. Copy comes from
 * the `workspace` catalog, read when a function runs.
 */
import type { CaseSummary } from '@/features/cases'
import { i18n } from '@/lib/i18n'

const t = i18n.getFixedT(null, 'workspace')

/** First case of the list that is not in `skip` (cases just closed here). */
export function firstSelectableCase(
  items: readonly Pick<CaseSummary, 'id'>[],
  skip: ReadonlySet<string> = new Set(),
): string | null {
  return items.find((item) => !skip.has(item.id))?.id ?? null
}

/**
 * After closing a case: the one below it in the list, else the one above, else
 * nothing (the screen then shows its empty state).
 */
export function nextCaseAfterClose(
  items: readonly Pick<CaseSummary, 'id'>[],
  closedId: string,
  skip: ReadonlySet<string> = new Set(),
): string | null {
  const index = items.findIndex((item) => item.id === closedId)
  const open = (item: Pick<CaseSummary, 'id'>) => item.id !== closedId && !skip.has(item.id)
  if (index < 0) return firstSelectableCase(items.filter(open))
  const below = items.slice(index + 1).find(open)
  if (below) return below.id
  return items.slice(0, index).reverse().find(open)?.id ?? null
}

// ─── Empty state ────────────────────────────────────────────────────────────

export interface EmptyWorkspaceCopy {
  title: string
  description: string
}

/** No open case at all; the paused variant explains why nothing arrives (contract §9.2). */
export function emptyWorkspaceCopy(paused: boolean): EmptyWorkspaceCopy {
  return {
    title: t('empty.title'),
    description: t(paused ? 'empty.paused' : 'empty.available'),
  }
}
