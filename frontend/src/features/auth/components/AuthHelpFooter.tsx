import { useToast } from '@/components/ui'
import { SIGN_IN_HELP } from '../model'

export interface AuthHelpFooterProps {
  /** Link text at the left. Default "¿Problemas para entrar?". */
  label?: string
}

/** Footer row of the login steps: who helps (Administración, in "Usuarios y roles"). */
export function AuthHelpFooter({ label = '¿Problemas para entrar?' }: AuthHelpFooterProps) {
  const { toast } = useToast()
  return (
    <div className="flex items-baseline justify-between gap-3 text-14">
      <button
        type="button"
        className="cursor-pointer text-link"
        onClick={() => toast({ title: 'Pide ayuda a Administración', description: SIGN_IN_HELP })}
      >
        {label}
      </button>
      <span className="text-muted">Te ayuda Administración</span>
    </div>
  )
}
