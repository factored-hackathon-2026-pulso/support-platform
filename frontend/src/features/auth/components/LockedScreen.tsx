import { Lock } from 'lucide-react'
import { Button, LinkButton, useToast } from '@/components/ui'
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
import { MicrosoftSignIn } from './MicrosoftSignIn'

export type LockedScreenProps = LockedRouteState

/** "Tu cuenta está bloqueada por 15 minutos" (canvas BoLocked) with a live countdown. */
export function LockedScreen({ email, unlockAt }: LockedScreenProps) {
  const remaining = useCountdown(unlockAt)
  const unlocked = remaining === 0
  const { toast } = useToast()

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

      <div className="flex flex-col gap-2.5">
        {unlocked ? (
          <LinkButton to="/login" replace variant="primary" size="lg" block>
            Volver a entrar
          </LinkButton>
        ) : (
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() =>
              toast({
                title: 'Restablecer contraseña',
                description:
                  'Pide el cambio a la mesa de ayuda: verifican tu identidad y te envían un enlace.',
              })
            }
          >
            Restablecer mi contraseña
          </Button>
        )}
        {remaining === null ? (
          // Unknown unlock time (page opened directly): let the user try again later.
          <LinkButton to="/login" replace variant="secondary" size="lg" block>
            Volver al ingreso
          </LinkButton>
        ) : null}
        <MicrosoftSignIn label="Entrar con Microsoft" />
      </div>

      <AuthNote>
        <span>¿No fuiste tú? Avisa a seguridad: alguien pudo intentar entrar con tu correo.</span>
        <span>Los intentos quedaron registrados con la hora, el dispositivo y la ubicación.</span>
      </AuthNote>

      <AuthHelpFooter />
    </>
  )
}
