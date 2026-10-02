import { Smartphone } from 'lucide-react'
import { Page, PageBody } from '@/components/layout'
import { Badge, EmptyState, PageHeader } from '@/components/ui'

/**
 * /cliente — customer chat simulator (dev/demo tool, outside the staff shell and
 * without staff auth). It will open a customer session (POST /customer/sessions)
 * and chat with the analyst Workspace in another window.
 */
export default function CustomerSimulatorRoute() {
  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <Page
        header={
          <PageHeader
            title="Simulador de cliente"
            subtitle="Escribe como un cliente de la app y responde desde el Workspace en otra ventana"
            actions={<Badge tone="accent">Herramienta de desarrollo</Badge>}
            className="bg-surface"
          />
        }
      >
        <PageBody className="flex items-center justify-center">
          <EmptyState
            icon={<Smartphone size={40} strokeWidth={1.6} />}
            title="En construcción"
            description="Aquí eliges un cliente de ejemplo y chateas con la analista en tiempo real. Llega en una próxima entrega."
          />
        </PageBody>
      </Page>
    </div>
  )
}
