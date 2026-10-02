import { useParams } from 'react-router'
import { ScreenPlaceholder } from '@/components/layout'

/** /automatizacion/propuestas/:proposalId — proposal review. */
export default function ProposalRoute() {
  const { proposalId } = useParams()
  return (
    <ScreenPlaceholder
      title="¿Habría resuelto bien los casos de tu equipo?"
      subtitle="Propuesta de automatización a partir de casos reales"
      detail={proposalId ? `Propuesta: ${proposalId}` : null}
    />
  )
}
