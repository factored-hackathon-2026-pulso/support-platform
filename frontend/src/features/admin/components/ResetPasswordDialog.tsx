import { useState } from 'react'
import { Button, Callout, Dialog } from '@/components/ui'
import { resetLinkCopy } from '../model'
import { useFailureHandler, useSendPasswordResetLink } from '../hooks'
import type { AdminUser, PasswordResetLinkSent } from '../types'

export interface ResetPasswordDialogProps {
  user: AdminUser
  onClose(): void
  onDone(result: PasswordResetLinkSent): void
}

/**
 * "¿Enviar a … un enlace para restablecer su contraseña?" (Admin.dc.html `dlg.reset`,
 * part 4): she gets a link by email (1 hour); her sessions end now; nobody else ever
 * sees the new password.
 */
export function ResetPasswordDialog({ user, onClose, onDone }: ResetPasswordDialogProps) {
  const send = useSendPasswordResetLink(user.id)
  const handleFailure = useFailureHandler()
  const [error, setError] = useState<string | null>(null)
  const copy = resetLinkCopy(user.name, user.email)

  function confirm() {
    setError(null)
    send.mutate(undefined, {
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
            Cancelar
          </Button>
          <Button variant="primary" loading={send.isPending} onClick={confirm}>
            Enviar enlace
          </Button>
        </>
      }
    >
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-14 text-ink-2">
        {copy.consequences.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Dialog>
  )
}
