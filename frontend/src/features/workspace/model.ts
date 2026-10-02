/**
 * Pure rules of the Workspace screen: URL state (`?caso=&estado=&q=&panel=&lista=&apoyo=`,
 * contract §7.1), which case to show, and the client header lines. No React, no
 * I/O: unit-tested in model.test.ts.
 */
import {
  countryName,
  inboxStatusFromSlug,
  slugFromInboxStatus,
  type CaseSummary,
  type InboxStatus,
} from '@/features/cases'
import { formatDate } from '@/lib/format'

export type SupportPanelTab = 'copiloto' | 'herramientas' | 'cliente'

export const SUPPORT_PANEL_TABS: readonly { value: SupportPanelTab; label: string }[] = [
  { value: 'copiloto', label: 'Copiloto' },
  { value: 'herramientas', label: 'Herramientas' },
  { value: 'cliente', label: 'Cliente' },
]

const DEFAULT_PANEL_TAB: SupportPanelTab = 'copiloto'

export interface WorkspaceUrlState {
  caseId: string | null
  /** `null` = Todos. */
  filter: InboxStatus | null
  query: string
  panelTab: SupportPanelTab
  panelCollapsed: boolean
  listCollapsed: boolean
}

export interface WorkspaceStateChangeOptions {
  /** Replace the history entry instead of pushing one (auto-selection, typing, toggles). */
  replace?: boolean
}

function isPanelTab(value: string | null): value is SupportPanelTab {
  return SUPPORT_PANEL_TABS.some((tab) => tab.value === value)
}

/** URLSearchParams → state. Unknown values fall back to the defaults. */
export function parseWorkspaceSearch(params: URLSearchParams): WorkspaceUrlState {
  const panel = params.get('panel')
  return {
    caseId: params.get('caso')?.trim() || null,
    filter: inboxStatusFromSlug(params.get('estado')),
    query: params.get('q') ?? '',
    panelTab: isPanelTab(panel) ? panel : DEFAULT_PANEL_TAB,
    panelCollapsed: params.get('apoyo') === 'contraido',
    listCollapsed: params.get('lista') === 'contraida',
  }
}

/** State → URLSearchParams, leaving defaults out so the URL stays short. */
export function toWorkspaceSearch(state: WorkspaceUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.caseId) params.set('caso', state.caseId)
  const slug = slugFromInboxStatus(state.filter)
  if (slug) params.set('estado', slug)
  if (state.query) params.set('q', state.query)
  if (state.panelTab !== DEFAULT_PANEL_TAB) params.set('panel', state.panelTab)
  if (state.listCollapsed) params.set('lista', 'contraida')
  if (state.panelCollapsed) params.set('apoyo', 'contraido')
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

// ─── Client header (Cliente tab) ────────────────────────────────────────────

export interface CustomerHeaderSource {
  id: string
  segment: string
  /** ISO date (YYYY-MM-DD). */
  customerSince: string
  city: string
  country: Parameters<typeof countryName>[0]
  documentType: string
}

/** "2019-02-01" → "feb 2019" (a calendar date: no time-zone shift). */
export function formatMonthYear(isoDate: string): string {
  const full = formatDate(`${isoDate.slice(0, 10)}T12:00:00Z`, { timeZone: 'UTC' })
  return full.split(' ').slice(1).join(' ')
}

/** "Plus · cliente desde feb 2019 · Barranquilla, Colombia". */
export function customerHeaderLine(customer: CustomerHeaderSource): string {
  return [
    customer.segment,
    `cliente desde ${formatMonthYear(customer.customerSince)}`,
    `${customer.city}, ${countryName(customer.country)}`,
  ].join(' · ')
}

/** "CUS-… · CC". */
export function customerHeaderId(
  customer: Pick<CustomerHeaderSource, 'id' | 'documentType'>,
): string {
  return `${customer.id} · ${customer.documentType}`
}

// ─── Empty state ────────────────────────────────────────────────────────────

export interface EmptyWorkspaceCopy {
  title: string
  description: string
}

/** `vacia` state; the paused variant explains why nothing arrives. */
export function emptyWorkspaceCopy(paused: boolean): EmptyWorkspaceCopy {
  return paused
    ? {
        title: 'No tienes contactos abiertos',
        description:
          'Estás en pausa: no te llegan casos nuevos. Vuelve a disponible para recibir el siguiente.',
      }
    : {
        title: 'No tienes contactos abiertos',
        description:
          'Estás disponible. Cuando un agente escale un contacto que te corresponde, aparece aquí.',
      }
}
