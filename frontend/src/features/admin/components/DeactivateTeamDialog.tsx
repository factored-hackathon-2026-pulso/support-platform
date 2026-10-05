import { useState } from 'react'
import { Button, Callout, Dialog } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
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
  const { t } = useTranslation('admin')

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
      title={t('team.deactivateTitle', { name: team.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button variant="danger" loading={deactivate.isPending} onClick={confirm}>
            {t('team.deactivate')}
          </Button>
        </>
      }
    >
      <p className="m-0 text-14 text-ink-2">{t('team.deactivateText')}</p>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Dialog>
  )
}
