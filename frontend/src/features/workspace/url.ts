/**
 * URL state of the Workspace ("Casos", `/analyst/cases`): the selected case, the filter, the
 * search, the collapsed list and the "Ficha del cliente" panel
 * (`?case=&status=&q=&list=&panel=&previous=`, docs/platform/api/slice-2-case-lifecycle.md
 * §9.2). Links into it are built by `workspacePath` (app/paths.ts). Pure: unit-tested in
 * url.test.ts.
 */
import { parseInboxStatus, type InboxStatus } from '@/features/cases'
import type { PreviousCasesSelection } from '@/features/conversation'

export interface WorkspaceUrlState {
  /** `?case=CASE-…`. */
  caseId: string | null
  /** `?status=` (the API `InboxStatus`): `null` = Todos (open cases); `closed` = Cerrados. */
  filter: InboxStatus | null
  /** `?q=`. */
  query: string
  /** `?list=collapsed`. */
  listCollapsed: boolean
  /** `?panel=customer`: "Ficha del cliente" is open (slice 6 §5). */
  customerFile: boolean
  /**
   * `?previous=`: "Casos anteriores" inside the panel: `list` (`PREVIOUS_CASES_LIST`), a past
   * case id (its transcript), or null (the list). A value also opens the panel.
   */
  history: PreviousCasesSelection | null
}

/** Whether "Ficha del cliente" shows (`?panel=customer`, or a `?previous=` deep link). */
export function isCustomerFileOpen(
  state: Pick<WorkspaceUrlState, 'customerFile' | 'history'>,
): boolean {
  return state.customerFile || state.history !== null
}

export interface WorkspaceStateChangeOptions {
  /** Replace the history entry instead of pushing one (auto-selection, typing, toggles). */
  replace?: boolean
}

/** URLSearchParams → state. Unknown values fall back to the defaults. */
export function parseWorkspaceSearch(params: URLSearchParams): WorkspaceUrlState {
  return {
    caseId: params.get('case')?.trim() || null,
    filter: parseInboxStatus(params.get('status')),
    query: params.get('q') ?? '',
    listCollapsed: params.get('list') === 'collapsed',
    customerFile: params.get('panel') === 'customer',
    history: params.get('previous')?.trim() || null,
  }
}

/** State → URLSearchParams, leaving defaults out so the URL stays short. */
export function toWorkspaceSearch(state: WorkspaceUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.caseId) params.set('case', state.caseId)
  if (state.filter) params.set('status', state.filter)
  if (state.query) params.set('q', state.query)
  if (state.listCollapsed) params.set('list', 'collapsed')
  if (state.customerFile) params.set('panel', 'customer')
  if (state.history) params.set('previous', state.history)
  return params
}
