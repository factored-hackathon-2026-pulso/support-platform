import { useState } from 'react'
import { Button, Callout, Dialog } from '@/components/ui'
import { cancelInvitationCopy } from '../model'
import { useCancelInvitation, useFailureHandler } from '../hooks'
import type { AdminUser, AdminUserChange } from '../types'

export interface CancelInvitationDialogProps {
  user: AdminUser
  onClose(): void
  onDone(change: AdminUserChange): void
}

/** "¿Cancelar la invitación de …?" (Admin.dc.html `dlg.cancelInvite`, part 4). */
export function CancelInvitationDialog({ user, onClose, onDone }: CancelInvitationDialogProps) {
  const cancel = useCancelInvitation(user.id)
  const handleFailure = useFailureHandler()
  const [error, setError] = useState<string | null>(null)
  const copy = cancelInvitationCopy(user.name)

  function confirm() {
    setError(null)
    cancel.mutate(undefined, {
      onSuccess: onDone,
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
      title={copy.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button variant="danger" loading={cancel.isPending} onClick={confirm}>
            Cancelar invitación
          </Button>
        </>
      }
    >
      <p className="m-0 text-14 text-ink-2">{copy.text}</p>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Dialog>
  )
}
