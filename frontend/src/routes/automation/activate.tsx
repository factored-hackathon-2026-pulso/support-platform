import { useParams } from 'react-router'
import { ScreenPlaceholder } from '@/components/layout'

/** /automatizacion/activar/:componentId — approval and rollout. */
export default function ActivateRoute() {
  const { componentId } = useParams()
  return (
    <ScreenPlaceholder
      title="Aprobar y activar"
      subtitle="Revisión final, porcentaje de casos y condiciones de parada"
      detail={componentId ? `Componente: ${componentId}` : null}
    />
  )
}
