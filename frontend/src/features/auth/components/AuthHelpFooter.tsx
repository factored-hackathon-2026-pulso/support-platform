import { useToast } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'

export interface AuthHelpFooterProps {
  /** Link text at the left. Default "¿Problemas para entrar?". */
  label?: string
}

/** Footer row of the login steps: who helps (Administración, in "Usuarios y roles"). */
export function AuthHelpFooter({ label }: AuthHelpFooterProps) {
  const { toast } = useToast()
  const { t } = useTranslation('auth')
  return (
    <div className="flex items-baseline justify-between gap-3 text-14">
      <button
        type="button"
        className="cursor-pointer text-link"
        onClick={() => toast({ title: t('help.title'), description: t('help.text') })}
      >
        {label ?? t('help.link')}
      </button>
      <span className="text-muted">{t('help.who')}</span>
    </div>
  )
}
