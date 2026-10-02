import { useParams } from 'react-router'
import { ScreenPlaceholder } from '@/components/layout'

/** /automatizacion/agentes/:agentId — agent file. */
export default function AgentDetailRoute() {
  const { agentId } = useParams()
  return (
    <ScreenPlaceholder
      title="Ficha del agente"
      subtitle="Instrucciones, herramientas, reglas y resultados"
      detail={agentId ? `Agente: ${agentId}` : null}
    />
  )
}
