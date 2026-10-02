import { useToast } from '@/components/ui'

export interface AuthHelpFooterProps {
  /** Link text at the left. Default "¿Problemas para entrar?". */
  label?: string
}

/** Footer row of the login steps: help action + help desk. */
export function AuthHelpFooter({ label = '¿Problemas para entrar?' }: AuthHelpFooterProps) {
  const { toast } = useToast()
  return (
    <div className="flex items-baseline justify-between gap-3 text-14">
      <button
        type="button"
        className="cursor-pointer text-link"
        onClick={() =>
          toast({
            title: 'Escribe a la mesa de ayuda',
            description:
              'Ellos restablecen tu contraseña o tu segundo factor después de verificar tu identidad.',
          })
        }
      >
        {label}
      </button>
      <span className="text-muted">Mesa de ayuda del contact center</span>
    </div>
  )
}
