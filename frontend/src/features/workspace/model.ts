/**
 * Pure rules of the Workspace screen: URL state (`?caso=&estado=&q=&lista=&ficha=&historial=`,
 * docs/platform/api/slice-2-case-lifecycle.md §9.2), which case to show, and the
 * empty-state copy. No React, no I/O: unit-tested in model.test.ts.
 */
import {
  inboxStatusFromSlug,
  slugFromInboxStatus,
  type CaseSummary,
  type InboxStatus,
} from '@/features/cases'

/** `historial=lista`: "Casos anteriores" (a section of "Ficha del cliente") on its list. */
export const HISTORY_LIST = 'lista'

export interface WorkspaceUrlState {
  caseId: string | null
  /** `null` = Todos (open cases); `closed` = Cerrados. */
  filter: InboxStatus | null
  query: string
  listCollapsed: boolean
  /** `?ficha=1`: "Ficha del cliente" is open (slice 6 §5). */
  customerFile: boolean
  /**
   * "Casos anteriores" inside the panel: `'lista'`, a past case id (its
   * transcript), or null (the list). A value also opens the panel, so the old
   * `?historial=` deep links keep working.
   */
  history: typeof HISTORY_LIST | string | null
}

/** Whether "Ficha del cliente" shows (`?ficha=1`, or a `?historial=` deep link). */
export function isCustomerFileOpen(
  state: Pick<WorkspaceUrlState, 'customerFile' | 'history'>,
): boolean {
  return state.customerFile || state.history !== null
}

export interface WorkspaceStateChangeOptions {
  /** Replace the history entry instead of pushing one (auto-selection, typing, toggles). */
  replace?: boolean
}

/**
 * URLSearchParams → state. Unknown values fall back to the defaults; the slice 1
 * params `panel` and `apoyo` (the removed support panel) are ignored.
 */
export function parseWorkspaceSearch(params: URLSearchParams): WorkspaceUrlState {
  return {
    caseId: params.get('caso')?.trim() || null,
    filter: inboxStatusFromSlug(params.get('estado')),
    query: params.get('q') ?? '',
    listCollapsed: params.get('lista') === 'contraida',
    customerFile: params.get('ficha') === '1',
    history: params.get('historial')?.trim() || null,
  }
}

/** State → URLSearchParams, leaving defaults out so the URL stays short. */
export function toWorkspaceSearch(state: WorkspaceUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.caseId) params.set('caso', state.caseId)
  const slug = slugFromInboxStatus(state.filter)
  if (slug) params.set('estado', slug)
  if (state.query) params.set('q', state.query)
  if (state.listCollapsed) params.set('lista', 'contraida')
  if (state.customerFile) params.set('ficha', '1')
  if (state.history) params.set('historial', state.history)
  return params
}

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
  return paused
    ? {
        title: 'No tienes casos abiertos',
        description:
          'Estás en pausa: no te llegan casos nuevos. Vuelve a disponible para recibir el siguiente.',
      }
    : {
        title: 'No tienes casos abiertos',
        description: 'Estás disponible. Cuando un cliente escriba y te corresponda, aparece aquí.',
      }
}
