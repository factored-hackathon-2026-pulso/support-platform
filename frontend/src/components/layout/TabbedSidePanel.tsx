import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { PanelRightClose } from 'lucide-react'
import { IconButton, Tab, TabList, TabPanel, Tabs } from '@/components/ui'

export interface SidePanelTab {
  value: string
  label: string
  content: ReactNode
  /**
   * `scroll` (default): the tab pads and scrolls its content. `fill`: the content takes the whole
   * tab and handles its own scroll (a thread with its box pinned at the bottom: "Copiloto").
   */
  layout?: 'scroll' | 'fill'
}

export interface TabbedSidePanelProps {
  /** Id of the panel (the triggers' `aria-controls`). */
  id: string
  /** Accessible name of the panel ("Apoyo del caso") and of its tab list ("Apoyo"). */
  label: string
  tabsLabel: string
  tabs: readonly SidePanelTab[]
  value: string
  onValueChange(value: string): void
  closeLabel: string
  onClose(): void
  /** Move the focus to the selected tab when it mounts (the person opened it). */
  focusOnOpen?: boolean
  /** Id of the element that gets the focus back after a close (the trigger). */
  returnFocusTo?: string
}

/**
 * The right panel of the Workspace with tabs (slice 19, AI on): the same slot as `SidePanel`
 * (not modal, Escape inside it closes it and the focus returns to the trigger), but its header
 * is a tab list ("Traspaso", "Copiloto", "Herramientas", "Cliente") with the close
 * button at its end. 400 px wide (IaWorkspace). Each tab's content scrolls inside it.
 */
export function TabbedSidePanel({
  id,
  label,
  tabsLabel,
  tabs,
  value,
  onValueChange,
  closeLabel,
  onClose,
  focusOnOpen = false,
  returnFocusTo,
}: TabbedSidePanelProps) {
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!focusOnOpen) return
    panelRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
  }, [focusOnOpen])

  const close = useCallback(() => {
    onClose()
    if (!returnFocusTo) return
    requestAnimationFrame(() => document.getElementById(returnFocusTo)?.focus())
  }, [onClose, returnFocusTo])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!(event.target instanceof Node) || !panelRef.current?.contains(event.target)) return
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close])

  const selected = tabs.some((tab) => tab.value === value) ? value : (tabs[0]?.value ?? '')
  return (
    <aside
      ref={panelRef}
      id={id}
      aria-label={label}
      className="flex h-full w-[400px] shrink-0 flex-col border-l border-border bg-surface"
    >
      <Tabs value={selected} onValueChange={onValueChange} className="flex min-h-0 grow flex-col">
        <TabList
          aria-label={tabsLabel}
          className="shrink-0 items-center gap-0.5 border-border-soft pr-2 pl-3"
          trailing={
            <IconButton
              size="sm"
              variant="ghost"
              aria-label={closeLabel}
              icon={<PanelRightClose size={16} aria-hidden="true" />}
              onClick={close}
            />
          }
        >
          {tabs.map((tab) => (
            <Tab key={tab.value} value={tab.value} className="min-h-[52px] px-2">
              {tab.label}
            </Tab>
          ))}
        </TabList>
        {tabs.map((tab) => (
          <TabPanel
            key={tab.value}
            value={tab.value}
            className={
              tab.layout === 'fill'
                ? 'flex min-h-0 grow flex-col'
                : 'flex min-h-0 grow scrollbar-thin flex-col gap-6 overflow-y-auto px-5 py-4'
            }
          >
            {tab.content}
          </TabPanel>
        ))}
      </Tabs>
    </aside>
  )
}
