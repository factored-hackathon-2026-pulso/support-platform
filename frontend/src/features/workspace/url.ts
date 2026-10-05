/**
 * URL state of the Workspace ("Casos", `/analyst/cases`): the selected case, the filter, the
 * search, the collapsed list and the right panel (the "Ficha del cliente"; slice 19, with AI on,
 * its tabs: `?panel=handoff` is "Traspaso", `?panel=customer` "Cliente"; slice 20 adds
 * `?panel=copilot` "Copiloto" and `?panel=tools` "Herramientas")
 * (`?case=&status=&q=&list=&panel=&previous=`, docs/platform/api/slice-2-case-lifecycle.md
 * §9.2). Links into it are built by `workspacePath` (app/paths.ts). Pure: unit-tested in
 * url.test.ts.
 */
import { parseInboxStatus, type InboxStatus } from '@/features/cases'
import type { PreviousCasesSelection } from '@/features/conversation'

/** The right panel's tab (slice 19: the ficha and "Traspaso"; slice 20: the copilot and the tools). */
export type WorkspacePanel = 'customer' | 'handoff' | 'copilot' | 'tools'

const PANELS: readonly WorkspacePanel[] = ['customer', 'handoff', 'copilot', 'tools']

export interface WorkspaceUrlState {
  /** `?case=CASE-…`. */
  caseId: string | null
  /** `?status=` (the API `InboxStatus`): `null` = Todos (open cases); `closed` = Cerrados. */
  filter: InboxStatus | null
  /** `?q=`. */
  query: string
  /** `?list=collapsed`. */
  listCollapsed: boolean
  /**
   * `?panel=`: the right panel and its tab. `customer` is "Ficha del cliente" (slice 6 §5; the
   * "Cliente" tab with AI on), `handoff` the "Traspaso" tab (slice 19), `copilot` "Copiloto" and
   * `tools` "Herramientas" (slice 20); those three only with AI on. null = closed.
   */
  panel: WorkspacePanel | null
  /**
   * `?previous=`: "Casos anteriores" inside the panel: `list` (`PREVIOUS_CASES_LIST`), a past
   * case id (its transcript), or null (the list). A value also opens the panel.
   */
  history: PreviousCasesSelection | null
}

/**
 * The tab the right panel shows, or null when it is closed: `?panel=`, else "Ficha del cliente"
 * for a `?previous=` deep link ("Casos anteriores" lives there).
 */
export function openPanel(
  state: Pick<WorkspaceUrlState, 'panel' | 'history'>,
): WorkspacePanel | null {
  if (state.history !== null) return 'customer'
  return state.panel
}

/** Whether "Ficha del cliente" shows (`?panel=customer`, or a `?previous=` deep link). */
export function isCustomerFileOpen(state: Pick<WorkspaceUrlState, 'panel' | 'history'>): boolean {
  return openPanel(state) === 'customer'
}

/** A tab value (or `?panel=`) → the panel, null when unknown. */
export function parsePanel(value: string | null): WorkspacePanel | null {
  return (PANELS as readonly (string | null)[]).includes(value) ? (value as WorkspacePanel) : null
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
    panel: parsePanel(params.get('panel')),
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
  if (state.panel) params.set('panel', state.panel)
  if (state.history) params.set('previous', state.history)
  return params
}
