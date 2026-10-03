import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'
import { REPLAYED_PASSWORD_COPY, temporaryPasswordCopy } from '../model'

export interface TemporaryPasswordResult {
  kind: 'created' | 'reset'
  name: string
  /** null: an idempotent replay of the create (the password was shown the first time). */
  password: string | null
}

export interface TemporaryPasswordDialogProps {
  result: TemporaryPasswordResult
  onClose(): void
  /** Offered on a replay ("Restablecer contraseña"). */
  onResetPassword?(): void
}

/**
 * The temporary password, shown once (contract §10.3). It lives only in the
 * parent's component state: never in the URL, the query cache or storage.
 */
export function TemporaryPasswordDialog({
  result,
  onClose,
  onResetPassword,
}: TemporaryPasswordDialogProps) {
  const [copied, setCopied] = useState(false)
  const copy = temporaryPasswordCopy(result.name, result.kind)

  function copyPassword() {
    if (!result.password) return
    void navigator.clipboard?.writeText(result.password).then(
      () => setCopied(true),
      () => undefined,
    )
  }

  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      dismissOnOverlayClick={false}
      title={copy.title}
      footerNote={result.password ? 'En desarrollo, el código de verificación es 000000.' : null}
      footer={
        <>
          {!result.password && onResetPassword ? (
            <Button variant="secondary" onClick={onResetPassword}>
              Restablecer contraseña
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose}>
            Listo
          </Button>
        </>
      }
    >
      {result.password ? (
        <>
          <p className="m-0 text-14 text-ink-2">{copy.text}</p>
          <div className="flex items-center justify-between gap-3 rounded-10 border border-border bg-subtle px-4 py-3">
            <p className="m-0 font-mono text-20 font-medium select-all">
              <span className="sr-only">Contraseña temporal: </span>
              {result.password}
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon={
                copied ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )
              }
              onClick={copyPassword}
            >
              {copied ? 'Copiada' : 'Copiar'}
            </Button>
          </div>
        </>
      ) : (
        <p className="m-0 text-14 text-ink-2">{REPLAYED_PASSWORD_COPY}</p>
      )}
    </Dialog>
  )
}
