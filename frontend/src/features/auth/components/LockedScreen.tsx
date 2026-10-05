import { Lock } from 'lucide-react'
import { PATHS } from '@/app/paths'
import { Callout, LinkButton } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
import { useCountdown } from '../hooks/use-countdown'
import {
  formatCountdown,
  LOCKOUT_MINUTES,
  lockedDescription,
  type LockedRouteState,
} from '../model'
import { AuthHeading } from './AuthHeading'
import { AuthHelpFooter } from './AuthHelpFooter'
import { AuthNote } from './AuthNote'

export type LockedScreenProps = LockedRouteState

/**
 * "Tu cuenta está bloqueada por 15 minutos" (canvas BoLocked) with a live countdown.
 * There is no self-service reset: Administración unlocks the account or resets the
 * password in "Usuarios y roles", and then the person can sign in right away.
 */
export function LockedScreen({ email, unlockAt }: LockedScreenProps) {
  const remaining = useCountdown(unlockAt)
  const unlocked = remaining === 0
  const { t } = useTranslation('auth')

  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-14 bg-danger-soft text-danger-strong"
      >
        <Lock size={26} />
      </span>
      <AuthHeading
        title={
          unlocked ? t('locked.unlockedTitle') : t('locked.title', { minutes: LOCKOUT_MINUTES })
        }
        subtitle={lockedDescription({ email, unlockAt })}
      />

      {remaining !== null && !unlocked ? (
        <div className="flex items-baseline gap-2.5 rounded-12 border border-border bg-surface p-4">
          <span
            role="timer"
            aria-label={t('locked.timer', { time: formatCountdown(remaining) })}
            className="font-mono text-[28px] font-medium tabular"
          >
            {formatCountdown(remaining)}
          </span>
          <span aria-hidden="true" className="text-14 text-ink-2">
            {t('locked.untilUnlock')}
          </span>
        </div>
      ) : null}

      {unlocked ? (
        <LinkButton to={PATHS.login} replace variant="primary" size="lg" block>
          {t('locked.signInAgain')}
        </LinkButton>
      ) : (
        <div className="flex flex-col gap-2.5">
          <Callout tone="info" title={t('locked.needNow')}>
            {t('locked.help')}
          </Callout>
          <LinkButton to={PATHS.login} replace variant="secondary" size="lg" block>
            {t('locked.backToSignIn')}
          </LinkButton>
        </div>
      )}

      <AuthNote>
        <span>{t('locked.notYou')}</span>
        <span>{t('locked.audited')}</span>
      </AuthNote>

      <AuthHelpFooter />
    </>
  )
}
