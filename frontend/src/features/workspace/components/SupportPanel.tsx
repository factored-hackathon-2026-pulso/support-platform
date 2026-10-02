import { PanelRightClose, PanelRightOpen, Sparkles, UserRound, Wrench } from 'lucide-react'
import { IconButton, Tab, TabList, TabPanel, Tabs } from '@/components/ui'
import { SUPPORT_PANEL_TABS, type SupportPanelTab } from '../model'
import { ClientPlaceholder } from './ClientPlaceholder'
import { CopilotPlaceholder } from './CopilotPlaceholder'
import { ToolsPlaceholder } from './ToolsPlaceholder'

export interface SupportPanelProps {
  caseId: string
  tab: SupportPanelTab
  collapsed: boolean
  onTabChange: (tab: SupportPanelTab) => void
  onCollapsedChange: (collapsed: boolean) => void
  /** Rail icon: expand the panel on that tab (one state change). */
  onOpenTab: (tab: SupportPanelTab) => void
}

const RAIL_ICONS: Record<SupportPanelTab, typeof Sparkles> = {
  copiloto: Sparkles,
  herramientas: Wrench,
  cliente: UserRound,
}

/**
 * Right support panel (Copiloto · Herramientas · Cliente), collapsible to an
 * icon rail (`panelContraido`). Slice 1 renders the shell and designed
 * placeholders; slice 2/3 fill the tabs.
 */
export function SupportPanel({
  caseId,
  tab,
  collapsed,
  onTabChange,
  onCollapsedChange,
  onOpenTab,
}: SupportPanelProps) {
  if (collapsed) {
    return (
      <aside
        aria-label="Panel de apoyo, contraído"
        className="flex h-full w-14 shrink-0 flex-col items-center gap-2 border-l border-border bg-surface py-3"
      >
        <IconButton
          aria-label="Mostrar el panel"
          icon={<PanelRightOpen size={16} />}
          className="rounded-8"
          onClick={() => onCollapsedChange(false)}
        />
        {SUPPORT_PANEL_TABS.map(({ value, label }) => {
          const Icon = RAIL_ICONS[value]
          return (
            <IconButton
              key={value}
              aria-label={label}
              variant="soft"
              icon={<Icon size={18} />}
              onClick={() => onOpenTab(value)}
            />
          )
        })}
      </aside>
    )
  }

  return (
    <aside
      aria-label="Panel de apoyo"
      className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-surface"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as SupportPanelTab)}
        fitted
        className="flex min-h-0 grow flex-col"
      >
        <TabList
          aria-label="Paneles"
          trailing={
            <button
              type="button"
              aria-label="Contraer el panel"
              title="Contraer"
              onClick={() => onCollapsedChange(true)}
              className="flex w-11 shrink-0 cursor-pointer items-center justify-center border-l border-border-soft bg-surface text-ink hover:bg-subtle"
            >
              <PanelRightClose size={16} aria-hidden="true" />
            </button>
          }
        >
          {SUPPORT_PANEL_TABS.map(({ value, label }) => (
            <Tab key={value} value={value}>
              {label}
            </Tab>
          ))}
        </TabList>
        <TabPanel value="copiloto" className="flex min-h-0 grow flex-col">
          <CopilotPlaceholder />
        </TabPanel>
        <TabPanel value="herramientas" className="flex min-h-0 grow flex-col">
          <ToolsPlaceholder />
        </TabPanel>
        <TabPanel value="cliente" className="flex min-h-0 grow flex-col">
          <ClientPlaceholder caseId={caseId} />
        </TabPanel>
      </Tabs>
    </aside>
  )
}
