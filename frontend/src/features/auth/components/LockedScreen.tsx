import { Lock } from 'lucide-react'
import { Callout, LinkButton } from '@/components/ui'
import { useCountdown } from '../hooks/use-countdown'
import {
  formatCountdown,
  LOCKED_HELP,
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
          unlocked
            ? 'Ya puedes volver a intentar'
            : `Tu cuenta está bloqueada por ${LOCKOUT_MINUTES} minutos`
        }
        subtitle={lockedDescription({ email, unlockAt })}
      />

      {remaining !== null && !unlocked ? (
        <div className="flex items-baseline gap-2.5 rounded-12 border border-border bg-surface p-4">
          <span
            role="timer"
            aria-label={`Faltan ${formatCountdown(remaining)} para desbloquear`}
            className="font-mono text-[28px] font-medium tabular"
          >
            {formatCountdown(remaining)}
          </span>
          <span aria-hidden="true" className="text-14 text-ink-2">
            para desbloquear
          </span>
        </div>
      ) : null}

      {unlocked ? (
        <LinkButton to="/login" replace variant="primary" size="lg" block>
          Volver a entrar
        </LinkButton>
      ) : (
        <div className="flex flex-col gap-2.5">
          <Callout tone="info" title="¿Necesitas entrar ya?">
            {LOCKED_HELP} Cuando lo haga, puedes entrar sin esperar.
          </Callout>
          <LinkButton to="/login" replace variant="secondary" size="lg" block>
            Volver al ingreso
          </LinkButton>
        </div>
      )}

      <AuthNote>
        <span>
          ¿No fuiste tú? Avísale a Administración: alguien pudo intentar entrar con tu correo.
        </span>
        <span>Los intentos quedaron registrados en la auditoría.</span>
      </AuthNote>

      <AuthHelpFooter />
    </>
  )
}
