import { Mic, MicOff, Pause, Phone, PhoneOff, Play } from 'lucide-react'
import { Button, Fact, Status, useToast } from '@/components/ui'
import { formatTimer } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { useTranslation } from '@/lib/i18n'
import {
  CALL_STATUS,
  callControls,
  callDirectionFact,
  callElapsedSeconds,
  callStateLabel,
  describeCallFailure,
  isActiveCall,
} from '../channels'
import { useCallCommand, type CallAction } from '../hooks'
import type { Call } from '../types'

export interface CallBarProps {
  caseId: string
  call: Call
  /** The assignee in the Workspace: the bar has its buttons. Supervision only reads it. */
  canAct: boolean
}

/**
 * The call bar under the header (slice 12, canvas "llamada", "llamadaEspera",
 * "llamadaSaliente", "llamadaTerminada"): the state as Linear shows it (glyph + word:
 * Sonando, En llamada, En espera, Llamada terminada), the live timer from the call's own
 * times, the direction and "Silenciado"; then "Contestar" while an inbound call rings,
 * "Poner en espera" / "Retomar", "Silenciar" (a toggle) and "Colgar".
 */
export function CallBar({ caseId, call, canAct }: CallBarProps) {
  const { t } = useTranslation('conversation')
  const active = isActiveCall(call)
  const now = useNow(1000, active)
  const command = useCallCommand(caseId)
  const { toast } = useToast()
  const controls = callControls(call, canAct)
  const status = CALL_STATUS[call.state]
  const { key: _key, ...direction } = callDirectionFact(call.direction)

  function act(action: CallAction) {
    if (command.isPending) return
    command.mutate(
      { callId: call.id, action },
      {
        onError: (error) =>
          toast({
            title: t('call.bar.failed'),
            description: describeCallFailure(error),
            politeness: 'alert',
          }),
      },
    )
  }

  const busy = command.isPending
  return (
    <section
      aria-label={t('call.bar.region')}
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-2.5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <output className="inline-flex">
          <Status {...status} label={callStateLabel(call)} />
        </output>
        {active ? (
          <span className="font-mono text-14 text-ink" title={t('call.bar.duration')}>
            <span className="sr-only">{t('call.bar.durationLead')} </span>
            {formatTimer(callElapsedSeconds(call, now))}
          </span>
        ) : null}
        <Fact {...direction} size="md" />
        {active && call.muted ? (
          <Fact icon="mic-off" text={t('call.bar.muted')} tone="warn" size="md" />
        ) : null}
      </div>
      {controls.answer || controls.hangUp ? (
        <div className="flex flex-wrap items-center gap-2">
          {controls.answer ? (
            <Button
              variant="primary"
              icon={<Phone size={15} aria-hidden="true" />}
              aria-disabled={busy || undefined}
              onClick={() => act('answer')}
            >
              {t('call.bar.answer')}
            </Button>
          ) : null}
          {controls.hold ? (
            <Button
              variant="secondary"
              icon={<Pause size={15} aria-hidden="true" />}
              aria-disabled={busy || undefined}
              onClick={() => act('hold')}
            >
              {t('call.bar.hold')}
            </Button>
          ) : null}
          {controls.resume ? (
            <Button
              variant="secondary"
              icon={<Play size={15} aria-hidden="true" />}
              aria-disabled={busy || undefined}
              onClick={() => act('resume')}
            >
              {t('call.bar.resume')}
            </Button>
          ) : null}
          {controls.mute ? (
            <Button
              variant={call.muted ? 'primary' : 'secondary'}
              aria-pressed={call.muted}
              icon={
                call.muted ? (
                  <MicOff size={15} aria-hidden="true" />
                ) : (
                  <Mic size={15} aria-hidden="true" />
                )
              }
              aria-disabled={busy || undefined}
              onClick={() => act({ muted: !call.muted })}
            >
              {t('call.bar.mute')}
            </Button>
          ) : null}
          {controls.hangUp ? (
            <Button
              variant="danger"
              icon={<PhoneOff size={15} aria-hidden="true" />}
              aria-disabled={busy || undefined}
              onClick={() => act('hangup')}
            >
              {t('call.bar.hangUp')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
