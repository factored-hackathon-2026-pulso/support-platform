import { useSearchParams } from 'react-router'
import { ScreenPlaceholder } from '@/components/layout'

/** /analista — Workspace. The selected case lives in the URL (?caso=CASE-…). */
export default function WorkspaceRoute() {
  const [searchParams] = useSearchParams()
  const caseId = searchParams.get('caso')
  return (
    <ScreenPlaceholder
      title="Casos"
      subtitle="Contactos abiertos, conversación, copiloto y herramientas"
      description="Aquí atiendes tus casos: la lista por estado, la conversación con el cliente y el panel de apoyo."
      detail={caseId ? `Caso seleccionado: ${caseId}` : null}
    />
  )
}
