import { useState, type ReactNode } from 'react'
import { Check, Search, Zap } from 'lucide-react'
import { Callout, Tab, TabList, TabPanel, Tabs } from '@/components/ui'

type ToolGroup = 'acciones' | 'consultas' | 'hechas'

const GROUPS: readonly { value: ToolGroup; label: string; icon: ReactNode; empty: string }[] = [
  {
    value: 'acciones',
    label: 'Acciones',
    icon: <Zap size={14} strokeWidth={2.2} aria-hidden="true" />,
    empty: 'No hay acciones para este caso.',
  },
  {
    value: 'consultas',
    label: 'Consultas',
    icon: <Search size={14} strokeWidth={2.2} aria-hidden="true" />,
    empty: 'No hay consultas para este caso.',
  },
  {
    value: 'hechas',
    label: 'Hechas',
    icon: <Check size={14} strokeWidth={2.2} aria-hidden="true" />,
    empty: 'Todavía no se hizo nada en este caso.',
  },
]

/** Herramientas tab until slice 3: the three groups with their empty states. */
export function ToolsPlaceholder() {
  const [group, setGroup] = useState<ToolGroup>('acciones')
  return (
    <div className="flex min-h-0 grow scrollbar-thin flex-col gap-3 overflow-y-auto px-[18px] py-4">
      <Tabs value={group} onValueChange={(value) => setGroup(value as ToolGroup)} fitted>
        <TabList
          aria-label="Tipo de herramienta"
          className="gap-1 rounded-10 border-b-0 bg-canvas p-[3px]"
        >
          {GROUPS.map((item) => (
            <Tab
              key={item.value}
              value={item.value}
              count={0}
              className="mb-0 min-h-[34px] gap-1.5 rounded-8 border-b-0 px-2 text-13 text-ink aria-selected:bg-surface"
            >
              {item.icon}
              {item.label}
            </Tab>
          ))}
        </TabList>
        {GROUPS.map((item) => (
          <TabPanel key={item.value} value={item.value} className="pt-3">
            <p className="m-0 text-13 text-muted">{item.empty}</p>
          </TabPanel>
        ))}
      </Tabs>
      <Callout tone="neutral" role="note">
        Las herramientas llegan en una próxima entrega: consultar movimientos, bloquear la tarjeta,
        abrir el reclamo y pedir aprobaciones.
      </Callout>
      <p className="m-0 text-12 leading-[1.45] text-muted">
        Llegan con los datos del caso cargados. Cada uso queda en auditoría.
      </p>
    </div>
  )
}
