import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, MousePointerClick } from 'lucide-react'
import { useCurrentUser } from '@/app/session'
import { DocumentTitle, EmptyState, Spinner } from '@/components/ui'
import {
  CaseListPanel,
  sortByUrgency,
  useAvailability,
  useInbox,
  type InboxStatus,
} from '@/features/cases'
import { SidePanel } from '@/components/layout'
import {
  CUSTOMER_FILE_PANEL_ID,
  CUSTOMER_FILE_TRIGGER_ID,
  ConversationPane,
  CustomerFile,
} from '@/features/conversation'
import { useNow } from '@/lib/hooks'
import { topics, useRealtimeSubscription } from '@/lib/realtime'
import {
  emptyWorkspaceCopy,
  isCustomerFileOpen,
  firstSelectableCase,
  nextCaseAfterClose,
  type WorkspaceStateChangeOptions,
  type WorkspaceUrlState,
} from '../model'

/** Same tick as the list, so the order the screen follows is the one on screen. */
const ORDER_TICK_MS = 30_000

type FocusRequest = { kind: 'case'; caseId: string } | { kind: 'empty' }

export interface WorkspaceScreenProps {
  state: WorkspaceUrlState
  onStateChange(patch: Partial<WorkspaceUrlState>, options?: WorkspaceStateChangeOptions): void
}

/**
 * Analyst Workspace (Workspace.dc.html, contract §9.2): the "Casos" list
 * (collapsible to a rail), the conversation, and, on demand, the right panel
 * "Ficha del cliente" (slice 6 §5: the customer, this case and "Casos
 * anteriores"; `?ficha=1`, opened from the customer's name). All shareable state
 * lives in the URL (`state`); the screen reports changes through
 * `onStateChange` and the route writes them back.
 *
 * Owns the `<main>` landmark; the conversation renders inside it.
 *
 * Focus: when the screen switches case on its own (next case after "Cerrar
 * caso", "Ver caso" in the toast) the control that had the focus is gone, so
 * the focus moves to the new case heading, or to the empty state's heading
 * when nothing is left. Picking a card keeps the focus on the card.
 */
export function WorkspaceScreen({ state, onStateChange }: WorkspaceScreenProps) {
  const user = useCurrentUser()
  useRealtimeSubscription(topics.inbox(user.id))

  // Same query (and cache entry) as the list when there is no search: used to
  // auto-select the first case of the filter and to detect an empty inbox.
  const inbox = useInbox({ status: state.filter, q: '' })
  const availability = useAvailability()
  const closedHere = useRef(new Set<string>())
  /** Where the focus goes after a programmatic switch: a case heading, or the empty state. */
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const emptyHeading = useRef<HTMLHeadingElement>(null)

  // The list's order (urgency; Cerrados keeps the server's most-recent-close order):
  // auto-selection and "next case after closing" follow what the analyst sees.
  const data = inbox.data
  const now = useNow(ORDER_TICK_MS)
  const items = useMemo(
    () => (data && state.filter !== 'closed' ? sortByUrgency(data.items, now) : data?.items),
    [data, state.filter, now],
  )
  const ready = inbox.status === 'success' && !inbox.isPlaceholderData
  /** The panel was opened here (not restored from the URL): its heading takes the focus. */
  const [panelOpenedHere, setPanelOpenedHere] = useState(false)

  /**
   * The filter whose first load already had its chance to auto-select. Auto-select runs
   * once per loaded list (the screen opening, or the analyst picking another filter),
   * never for a case that arrives over the socket afterwards: opening it would mark it
   * read and record an open she never made, and hide the "Te asignaron un caso" toast.
   */
  const autoSelectedFor = useRef<InboxStatus | null | undefined>(undefined)

  useEffect(() => {
    if (autoSelectedFor.current === state.filter) return
    if (state.caseId) {
      autoSelectedFor.current = state.filter
      return
    }
    if (!ready || !items) return
    autoSelectedFor.current = state.filter
    const first = firstSelectableCase(items, closedHere.current)
    if (!first) return
    onStateChange({ caseId: first }, { replace: true })
  }, [state.caseId, state.filter, ready, items, onStateChange])

  // Another case resets "Casos anteriores": it belongs to the previous customer. The
  // panel itself stays open (the next customer's file).
  const panelOpen = isCustomerFileOpen(state)
  const selectCase = useCallback(
    (caseId: string) => onStateChange({ caseId, history: null, customerFile: panelOpen }),
    [onStateChange, panelOpen],
  )

  const openNotifiedCase = useCallback(
    (caseId: string) => {
      setFocusRequest({ kind: 'case', caseId })
      onStateChange({ caseId, history: null, customerFile: panelOpen })
    },
    [onStateChange, panelOpen],
  )

  const toggleCustomerFile = useCallback(() => {
    if (panelOpen) {
      onStateChange({ customerFile: false, history: null })
      return
    }
    setPanelOpenedHere(true)
    onStateChange({ customerFile: true })
  }, [panelOpen, onStateChange])
  const closeCustomerFile = useCallback(
    () => onStateChange({ customerFile: false, history: null }),
    [onStateChange],
  )
  const selectHistory = useCallback(
    (history: string) => onStateChange({ history }, { replace: true }),
    [onStateChange],
  )

  const handleClosed = useCallback(
    (caseId: string) => {
      closedHere.current.add(caseId)
      const next = nextCaseAfterClose(items ?? [], caseId, closedHere.current)
      setFocusRequest(next ? { kind: 'case', caseId: next } : { kind: 'empty' })
      onStateChange({ caseId: next, history: null }, { replace: true })
    },
    [items, onStateChange],
  )

  const clearFocusRequest = useCallback(() => setFocusRequest(null), [])

  const showsEmptyState = !state.caseId && inbox.status !== 'pending'
  useEffect(() => {
    if (focusRequest?.kind !== 'empty' || !showsEmptyState || !emptyHeading.current) return
    emptyHeading.current.focus()
    setFocusRequest((request) => (request?.kind === 'empty' ? null : request))
  }, [focusRequest, showsEmptyState])

  const inboxEmpty = inbox.data !== undefined && inbox.data.counts.all === 0
  const paused = availability.data?.status === 'paused'

  return (
    <div className="flex h-full min-h-0">
      <DocumentTitle title="Casos" />
      <CaseListPanel
        selectedCaseId={state.caseId}
        filter={state.filter}
        query={state.query}
        collapsed={state.listCollapsed}
        onSelectCase={selectCase}
        onOpenNotifiedCase={openNotifiedCase}
        onFilterChange={(filter: InboxStatus | null) => onStateChange({ filter })}
        onQueryChange={(query) => onStateChange({ query }, { replace: true })}
        onCollapsedChange={(listCollapsed) => onStateChange({ listCollapsed }, { replace: true })}
      />

      <main className="flex min-w-0 grow flex-col bg-canvas">
        {state.caseId ? (
          <ConversationPane
            caseId={state.caseId}
            onClosed={handleClosed}
            customerFile={{ open: panelOpen, onToggle: toggleCustomerFile }}
            focusOnLoad={focusRequest?.kind === 'case' && focusRequest.caseId === state.caseId}
            onFocused={clearFocusRequest}
          />
        ) : inbox.status === 'pending' ? (
          <div className="flex grow items-center justify-center text-muted">
            <Spinner label="Cargando tus casos" size={24} />
          </div>
        ) : inboxEmpty ? (
          <EmptyState
            className="grow"
            headingRef={emptyHeading}
            icon={<MessageSquare size={40} strokeWidth={1.6} />}
            {...emptyWorkspaceCopy(paused)}
          />
        ) : (
          <EmptyState
            className="grow"
            headingRef={emptyHeading}
            icon={<MousePointerClick size={40} strokeWidth={1.6} />}
            title="Elige un caso de la lista"
            description="La conversación con el cliente aparece aquí."
          />
        )}
      </main>

      {state.caseId && panelOpen ? (
        <SidePanel
          id={CUSTOMER_FILE_PANEL_ID}
          title="Ficha del cliente"
          closeLabel="Cerrar la ficha del cliente"
          onClose={closeCustomerFile}
          focusOnOpen={panelOpenedHere}
          returnFocusTo={CUSTOMER_FILE_TRIGGER_ID}
        >
          <CustomerFile
            key={state.caseId}
            caseId={state.caseId}
            history={state.history}
            onHistoryChange={selectHistory}
          />
        </SidePanel>
      ) : null}
    </div>
  )
}
