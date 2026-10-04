import { useState } from 'react'
import { supervisionAnalystPath } from '@/app/roles'
import { Button, Callout, Dialog, LinkButton } from '@/components/ui'
import { DEACTIVATE_CONSEQUENCES, deactivateBlockedCopy } from '../model'
import { useDeactivateUser, useFailureHandler, useRecheckAdminUser } from '../hooks'
import type { AdminUser, AdminUserChange } from '../types'

export interface DeactivateUserDialogProps {
  user: AdminUser
  /** The viewer also holds Supervisión: the open-case block links to supervision. */
  canOpenSupervision: boolean
  onClose(): void
  onDone(change: AdminUserChange): void
}

/**
 * "¿Desactivar la cuenta de …?" (contract §10.3). Open cases block it until
 * supervision reassigns them (§3.6): the confirm is disabled and, for a
 * supervisor-admin, "Ver en Equipo" opens her analyst sheet. The
 * person is re-read on open, so a count supervision already cleared never
 * keeps the block: the confirm waits for that read.
 */
export function DeactivateUserDialog({
  user,
  canOpenSupervision,
  onClose,
  onDone,
}: DeactivateUserDialogProps) {
  const deactivate = useDeactivateUser(user.id)
  const handleFailure = useFailureHandler()
  const [error, setError] = useState<string | null>(null)
  const checking = useRecheckAdminUser(user.id)
  const blocked = !checking && user.openCases.total > 0

  function confirm() {
    setError(null)
    deactivate.mutate(user.version, {
      onSuccess: (change) => onDone(change),
      onError: (problem) => setError(handleFailure(problem, { kind: 'user', id: user.id }).message),
    })
  }

  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`¿Desactivar la cuenta de ${user.name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={checking || blocked}
            loading={deactivate.isPending}
            onClick={confirm}
          >
            Desactivar cuenta
          </Button>
        </>
      }
    >
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-14 text-ink-2">
        {DEACTIVATE_CONSEQUENCES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {blocked ? (
        <Callout
          tone="warn"
          title={deactivateBlockedCopy(user.openCases.total).title}
          actions={
            canOpenSupervision ? (
              <LinkButton size="sm" variant="secondary" to={supervisionAnalystPath(user.id)}>
                Ver en Equipo
              </LinkButton>
            ) : null
          }
        >
          {deactivateBlockedCopy(user.openCases.total).text}
        </Callout>
      ) : null}
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Dialog>
  )
}
