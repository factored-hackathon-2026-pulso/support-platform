import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare, MousePointerClick } from 'lucide-react'
import { useCurrentUser } from '@/app/session'
import { DocumentTitle, EmptyState, Spinner } from '@/components/ui'
import { CaseListPanel, useAvailability, useInbox, type InboxStatus } from '@/features/cases'
import { ConversationPane } from '@/features/conversation'
import { topics, useRealtimeSubscription } from '@/lib/realtime'
import {
  emptyWorkspaceCopy,
  firstSelectableCase,
  nextCaseAfterClose,
  type SupportPanelTab,
  type WorkspaceStateChangeOptions,
  type WorkspaceUrlState,
} from '../model'
import { SupportPanel } from './SupportPanel'

type FocusRequest = { kind: 'case'; caseId: string } | { kind: 'empty' }

export interface WorkspaceScreenProps {
  state: WorkspaceUrlState
  onStateChange(patch: Partial<WorkspaceUrlState>, options?: WorkspaceStateChangeOptions): void
}

/**
 * Analyst Workspace (Workspace.dc.html): "Casos" list · conversation · support
 * panel. All shareable state lives in the URL (`state`); the screen reports
 * changes through `onStateChange` and the route writes them back.
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

  const items = inbox.data?.items
  const ready = inbox.status === 'success' && !inbox.isPlaceholderData

  useEffect(() => {
    if (state.caseId || !ready || !items) return
    const first = firstSelectableCase(items, closedHere.current)
    if (!first) return
    // A case that arrives while the empty state holds the focus takes it over.
    setFocusRequest((request) =>
      request?.kind === 'empty' ? { kind: 'case', caseId: first } : request,
    )
    onStateChange({ caseId: first }, { replace: true })
  }, [state.caseId, ready, items, onStateChange])

  const selectCase = useCallback((caseId: string) => onStateChange({ caseId }), [onStateChange])

  const openNotifiedCase = useCallback(
    (caseId: string) => {
      setFocusRequest({ kind: 'case', caseId })
      onStateChange({ caseId })
    },
    [onStateChange],
  )

  const handleClosed = useCallback(
    (caseId: string) => {
      closedHere.current.add(caseId)
      const next = nextCaseAfterClose(items ?? [], caseId, closedHere.current)
      setFocusRequest(next ? { kind: 'case', caseId: next } : { kind: 'empty' })
      onStateChange({ caseId: next }, { replace: true })
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
            description="La conversación, el copiloto y las herramientas del caso aparecen aquí."
          />
        )}
      </main>

      {state.caseId ? (
        <SupportPanel
          caseId={state.caseId}
          tab={state.panelTab}
          collapsed={state.panelCollapsed}
          onTabChange={(panelTab: SupportPanelTab) =>
            onStateChange({ panelTab }, { replace: true })
          }
          onCollapsedChange={(panelCollapsed) =>
            onStateChange({ panelCollapsed }, { replace: true })
          }
          onOpenTab={(panelTab) =>
            onStateChange({ panelTab, panelCollapsed: false }, { replace: true })
          }
        />
      ) : null}
    </div>
  )
}
