import { useId } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui'

export interface MicrosoftSignInProps {
  label?: string
}

/**
 * Corporate SSO entry from the canvas. There is no identity provider yet
 * (brief §4.5), so it is rendered disabled with the reason: the seam stays visible.
 */
export function MicrosoftSignIn({ label = 'Continuar con Microsoft' }: MicrosoftSignInProps) {
  const noteId = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="secondary"
        size="lg"
        block
        disabled
        aria-describedby={noteId}
        icon={<KeyRound size={20} aria-hidden="true" />}
      >
        {label}
      </Button>
      <span id={noteId} className="text-center text-13 text-muted">
        Ingreso con tu cuenta corporativa · aún no disponible en este entorno
      </span>
    </div>
  )
}
