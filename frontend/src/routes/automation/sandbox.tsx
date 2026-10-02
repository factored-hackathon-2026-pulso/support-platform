import { useParams } from 'react-router'
import { ScreenPlaceholder } from '@/components/layout'

/** /automatizacion/sandbox/:componentId — sandbox chat. */
export default function SandboxRoute() {
  const { componentId } = useParams()
  return (
    <ScreenPlaceholder
      title="Escríbele como si fueras un cliente"
      subtitle="Sandbox: prueba un componente sin tocar clientes reales"
      detail={componentId ? `Componente: ${componentId}` : null}
    />
  )
}
