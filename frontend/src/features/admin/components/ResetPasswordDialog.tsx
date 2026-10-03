import { useState } from 'react'
import { Button, Callout, Dialog } from '@/components/ui'
import { useFailureHandler, useResetPassword } from '../hooks'
import type { AdminUser, PasswordResetResult } from '../types'

export interface ResetPasswordDialogProps {
  user: AdminUser
  onClose(): void
  /** The new temporary password is handed to the parent (TemporaryPasswordDialog). */
  onDone(result: PasswordResetResult): void
}

/** "¿Restablecer la contraseña de …?" (contract §10.3): a confirm, then the new password. */
export function ResetPasswordDialog({ user, onClose, onDone }: ResetPasswordDialogProps) {
  const reset = useResetPassword(user.id)
  const handleFailure = useFailureHandler()
  const [error, setError] = useState<string | null>(null)

  function confirm() {
    setError(null)
    reset.mutate(undefined, {
      onSuccess: (result) => onDone(result),
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
      title={`¿Restablecer la contraseña de ${user.name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={reset.isPending} onClick={confirm}>
            Restablecer
          </Button>
        </>
      }
    >
      <p className="m-0 text-14 text-ink-2">
        Se genera una contraseña temporal nueva, se cierran sus sesiones abiertas y se desbloquea la
        cuenta si estaba bloqueada.
      </p>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Dialog>
  )
}
