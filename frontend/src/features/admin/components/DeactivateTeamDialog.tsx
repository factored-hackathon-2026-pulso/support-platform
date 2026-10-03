import { useState } from 'react'
import { Button, Callout, Dialog } from '@/components/ui'
import { useDeactivateTeam, useFailureHandler } from '../hooks'
import type { AdminTeam } from '../types'

export interface DeactivateTeamDialogProps {
  team: AdminTeam
  onClose(): void
  onDone(): void
}

/** "¿Desactivar el equipo …?" (contract §10.5). Members block it (`team_not_empty`). */
export function DeactivateTeamDialog({ team, onClose, onDone }: DeactivateTeamDialogProps) {
  const deactivate = useDeactivateTeam(team.id)
  const handleFailure = useFailureHandler()
  const [error, setError] = useState<string | null>(null)

  function confirm() {
    setError(null)
    deactivate.mutate(team.version, {
      onSuccess: onDone,
      onError: (problem) => setError(handleFailure(problem, { kind: 'team', id: team.id }).message),
    })
  }

  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`¿Desactivar el equipo ${team.name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" loading={deactivate.isPending} onClick={confirm}>
            Desactivar equipo
          </Button>
        </>
      }
    >
      <p className="m-0 text-14 text-ink-2">
        Ya no se podrá mover a nadie a este equipo. Su historial se conserva.
      </p>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Dialog>
  )
}
