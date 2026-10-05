import { Link2Off, Mail } from 'lucide-react'
import { Link } from 'react-router'
import { PATHS } from '@/app/paths'
import { DocumentTitle } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
import { invalidLinkCopy, type LinkKind } from '../model'

/**
 * "El enlace venció o ya se usó" (BoActivar `vencido`): one screen for an unknown,
 * expired, used or cancelled link (the server never says which).
 */
export function LinkInvalid({ kind }: { kind: LinkKind }) {
  const { t } = useTranslation('onboarding')
  const copy = invalidLinkCopy(kind)
  return (
    <>
      <DocumentTitle title={t('link.invalidTitle')} />
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-16 bg-warn-soft text-warn-strong"
      >
        <Link2Off size={28} />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-30 font-bold text-balance">
          {t('link.invalidTitle')}
        </h1>
        <p className="m-0 text-15 leading-[1.5] text-ink-2">{copy.text}</p>
      </div>
      <div className="flex gap-2.5 rounded-12 bg-panel px-4 py-3.5 text-14 leading-[1.5] text-ink-2">
        <Mail size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-ink">{copy.askTitle}</span>
          <span>{copy.askText}</span>
        </span>
      </div>
      <p className="m-0 text-14 text-ink-2">
        {copy.done}{' '}
        <Link to={PATHS.login} className="text-link font-semibold">
          {t('link.signIn')}
        </Link>
      </p>
    </>
  )
}
