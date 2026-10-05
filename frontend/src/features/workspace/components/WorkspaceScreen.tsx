import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { MessageSquare, MousePointerClick } from 'lucide-react'
import { useAiEnabled } from '@/app/platform'
import { useCurrentUser } from '@/app/session'
import { DocumentTitle, EmptyState, Spinner } from '@/components/ui'
import {
  CaseListPanel,
  caseType,
  sortByUrgency,
  useAvailability,
  useInbox,
  type InboxStatus,
} from '@/features/cases'
import { SidePanel, TabbedSidePanel, type SidePanelTab } from '@/components/layout'
import {
  CUSTOMER_FILE_PANEL_ID,
  CUSTOMER_FILE_TRIGGER_ID,
  SUPPORT_PANEL_TRIGGER_ID,
  ConversationPane,
  CustomerFile,
  HandoffPanel,
  describeHandoffFailure,
  useCaseDetail,
  useCaseHandoff,
} from '@/features/conversation'
import {
  CopilotPanel,
  StageStrip,
  ToolsPanel,
  copilotModeOf,
  copilotSurfaces,
  stageOfType,
  useAiStages,
  useCopilotAccess,
  useCopilotThread,
  useLatestSuggestion,
  type CopilotMode,
} from '@/features/copilot'
import { useNow } from '@/lib/hooks'
import { useTranslation } from '@/lib/i18n'
import { topics, useRealtimeSubscription } from '@/lib/realtime'
import { emptyWorkspaceCopy, firstSelectableCase, nextCaseAfterClose } from '../model'
import {
  openPanel,
  parsePanel,
  type WorkspacePanel,
  type WorkspaceStateChangeOptions,
  type WorkspaceUrlState,
} from '../url'

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
 * anteriores"; `?panel=customer`, opened from the customer's name). Slice 19: with AI on the
 * panel has tabs ("Traspaso" for a case the assistant handed over, `?panel=handoff`, opened by
 * the card's "Ver todo"; "Cliente", the ficha); with AI off it is the ficha, as before. Slice 20
 * adds "Copiloto" (`?panel=copilot`, also opened by the header's "Apoyo") and "Herramientas"
 * (`?panel=tools`), the copilot's draft above the composer and its recommendation to escalate,
 * all gated by one `copilotMode`: slice 21, the case type's stage (stage 0 and "Sin tipo": no
 * copilot), shown under the header as the stage strip. All shareable state
 * lives in the URL (`state`); the screen reports changes through
 * `onStateChange` and the route writes them back.
 *
 * Owns the `<main>` landmark; the conversation renders inside it.
 *
 * Focus: when the screen switches case on its own (next case after "Cerrar
 * caso", a notification's "Abrir caso" in the bell or a toast, which navigates here with
 * `state.focus = 'notification'`) the control that had the focus is gone, so
 * the focus moves to the new case heading, or to the empty state's heading
 * when nothing is left. Picking a card keeps the focus on the card.
 */
export function WorkspaceScreen({ state, onStateChange }: WorkspaceScreenProps) {
  const { t } = useTranslation(['workspace', 'cases'])
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

  // Slice 19/20: the AI tabs exist only while AI is on; with AI off the panel is the old ficha.
  const aiEnabled = useAiEnabled()
  // Slice 21: how far the copilot goes is the case type's stage (the same detail query as the
  // conversation, so nothing extra is fetched).
  const stages = useAiStages()
  const selectedType = useCaseDetail(state.caseId).data?.case.caseType
  const copilotMode: CopilotMode | null = aiEnabled
    ? copilotModeOf(stages.data, selectedType)
    : null
  const typeStage = aiEnabled ? stageOfType(stages.data, selectedType) : null
  const stageStrip =
    typeStage && selectedType ? (
      <StageStrip typeLabel={caseType(selectedType).label} stage={typeStage} />
    ) : null
  const requested = openPanel(state)
  const panel: WorkspacePanel | null =
    requested !== null && requested !== 'customer' && !aiEnabled ? null : requested
  const panelOpen = panel !== null
  /** Which trigger opened the panel: the focus goes back to it when it closes. */
  const [openedBy, setOpenedBy] = useState<'name' | 'support'>('name')
  // Another case resets "Casos anteriores": it belongs to the previous customer. The
  // panel itself stays open (the next customer's file).
  const selectCase = useCallback(
    (caseId: string) =>
      onStateChange({ caseId, history: null, panel: panel === 'handoff' ? 'customer' : panel }),
    [onStateChange, panel],
  )

  // Opened from a notification (slice 10): the bell's panel or the toast is gone.
  const location = useLocation()
  const fromNotification = (location.state as { focus?: string } | null)?.focus === 'notification'
  const caseId = state.caseId
  /** Once per navigation (``location.key``), not again when she picks another case. */
  const focusedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!fromNotification || !caseId || focusedFor.current === location.key) return
    focusedFor.current = location.key
    setFocusRequest({ kind: 'case', caseId })
  }, [fromNotification, caseId, location.key])

  const fileOpen = panel === 'customer'
  const toggleCustomerFile = useCallback(() => {
    if (fileOpen) {
      onStateChange({ panel: null, history: null })
      return
    }
    setPanelOpenedHere(true)
    setOpenedBy('name')
    onStateChange({ panel: 'customer' })
  }, [fileOpen, onStateChange])
  // Slice 20: "Apoyo" opens the panel at "Copiloto" (or its first tab) and closes it.
  const toggleSupportPanel = useCallback(() => {
    if (panelOpen) {
      onStateChange({ panel: null, history: null })
      return
    }
    setPanelOpenedHere(true)
    setOpenedBy('support')
    onStateChange({ panel: 'copilot' })
  }, [panelOpen, onStateChange])
  const closeCustomerFile = useCallback(
    () => onStateChange({ panel: null, history: null }),
    [onStateChange],
  )
  const openHandoff = useCallback(() => {
    setPanelOpenedHere(true)
    onStateChange({ panel: 'handoff', history: null })
  }, [onStateChange])
  const selectPanel = useCallback(
    (next: string) =>
      onStateChange({ panel: parsePanel(next) ?? 'customer', history: null }, { replace: true }),
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
      <DocumentTitle title={t('title')} />
      <CaseListPanel
        selectedCaseId={state.caseId}
        filter={state.filter}
        query={state.query}
        collapsed={state.listCollapsed}
        onSelectCase={selectCase}
        onFilterChange={(filter: InboxStatus | null) => onStateChange({ filter })}
        onQueryChange={(query) => onStateChange({ query }, { replace: true })}
        onCollapsedChange={(listCollapsed) => onStateChange({ listCollapsed }, { replace: true })}
      />

      <main className="flex min-w-0 grow flex-col bg-canvas">
        {state.caseId ? (
          <ConversationPane
            caseId={state.caseId}
            onClosed={handleClosed}
            customerFile={{ open: fileOpen, onToggle: toggleCustomerFile }}
            onOpenHandoff={aiEnabled ? openHandoff : undefined}
            copilotMode={copilotMode}
            stageStrip={stageStrip}
            supportPanel={aiEnabled ? { open: panelOpen, onToggle: toggleSupportPanel } : undefined}
            focusOnLoad={focusRequest?.kind === 'case' && focusRequest.caseId === state.caseId}
            onFocused={clearFocusRequest}
          />
        ) : inbox.status === 'pending' ? (
          <div className="flex grow items-center justify-center text-muted">
            <Spinner label={t('loading')} size={24} />
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
            title={t('pick.title')}
            description={t('pick.description')}
          />
        )}
      </main>

      {state.caseId && panelOpen && aiEnabled ? (
        <SupportPanel
          key={state.caseId}
          caseId={state.caseId}
          panel={panel}
          history={state.history}
          onHistoryChange={selectHistory}
          onPanelChange={selectPanel}
          onClose={closeCustomerFile}
          focusOnOpen={panelOpenedHere}
          copilotMode={copilotMode}
          returnFocusTo={
            openedBy === 'support' ? SUPPORT_PANEL_TRIGGER_ID : CUSTOMER_FILE_TRIGGER_ID
          }
        />
      ) : state.caseId && panelOpen ? (
        <SidePanel
          id={CUSTOMER_FILE_PANEL_ID}
          title={t('customerFile.title')}
          closeLabel={t('customerFile.close')}
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

interface SupportPanelProps {
  caseId: string
  panel: WorkspacePanel
  history: string | null
  onHistoryChange(history: string): void
  onPanelChange(panel: string): void
  onClose(): void
  focusOnOpen: boolean
  /** Which copilot tabs the case type's stage allows (slice 21). */
  copilotMode: CopilotMode | null
  returnFocusTo: string
}

/**
 * The right panel with AI on (IaWorkspace "Apoyo del caso"): "Traspaso" for a case the assistant
 * handed to her (slice 19: while the handoff loads, or can be retried), "Copiloto" while her
 * thread is `available` and "Herramientas" while the suggestions are (slice 20; both only for her
 * own case and as far as `copilotMode` allows), then "Cliente" (the ficha).
 */
function SupportPanel({
  caseId,
  panel,
  history,
  onHistoryChange,
  onPanelChange,
  onClose,
  focusOnOpen,
  copilotMode,
  returnFocusTo,
}: SupportPanelProps) {
  const { t } = useTranslation(['workspace', 'cases'])
  const detail = useCaseDetail(caseId)
  const { handoff, available } = useCaseHandoff(detail.data)
  // The tab shows while the packet loads, once it loaded, and with a retry for an agent-core
  // outage; a handoff that cannot be read at all (403, 404) has no tab.
  const showsHandoff =
    available && (handoff.status !== 'error' || describeHandoffFailure(handoff.error).retry)
  const surfaces = copilotSurfaces(copilotMode)
  const access = useCopilotAccess(detail.data?.case)
  const thread = useCopilotThread(caseId, access && surfaces.copilot)
  const latest = useLatestSuggestion(caseId, access && surfaces.tools)
  const showsCopilot = surfaces.copilot && access && thread.data?.available === true
  const showsTools = surfaces.tools && access && latest.data?.available === true
  const summary = detail.data?.case
  const closed = summary?.status === 'closed'
  const tabs: SidePanelTab[] = [
    ...(showsHandoff && detail.data
      ? [
          {
            value: 'handoff',
            label: t('support.handoff'),
            content: <HandoffPanel detail={detail.data} />,
          },
        ]
      : []),
    ...(showsCopilot && summary
      ? [
          {
            value: 'copilot',
            label: t('support.copilot'),
            layout: 'fill' as const,
            content: (
              <CopilotPanel
                caseId={caseId}
                customerName={summary.customer.displayName}
                closed={closed}
              />
            ),
          },
        ]
      : []),
    ...(showsTools
      ? [
          {
            value: 'tools',
            label: t('support.tools'),
            content: (
              <ToolsPanel
                caseId={caseId}
                closed={closed}
                canAsk={showsCopilot}
                onOpenCopilot={showsCopilot ? () => onPanelChange('copilot') : undefined}
              />
            ),
          },
        ]
      : []),
    {
      value: 'customer',
      label: t('support.customer'),
      content: <CustomerFile caseId={caseId} history={history} onHistoryChange={onHistoryChange} />,
    },
  ]
  return (
    <TabbedSidePanel
      id={CUSTOMER_FILE_PANEL_ID}
      label={t('support.label')}
      tabsLabel={t('support.tabs')}
      tabs={tabs}
      value={panel}
      onValueChange={onPanelChange}
      closeLabel={t('support.close')}
      onClose={onClose}
      focusOnOpen={focusOnOpen}
      returnFocusTo={returnFocusTo}
    />
  )
}
