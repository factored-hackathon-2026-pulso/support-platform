import { Check, Lock, Mail, Smartphone } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'
import { Trans, useTranslation } from '@/lib/i18n'
import { INVITATION_STEPS, invitationExpirySentence, invitationSentFootnote } from '../model'

const STEP_ICON = { lock: Lock, smartphone: Smartphone, check: Check } as const

export interface InvitationSentDialogProps {
  /** Where the invitation went. */
  email: string
  onClose(): void
}

/**
 * "Invitación enviada" (Admin.dc.html `invitacion`, part 4): the person gets a link by
 * email; nobody, administration included, ever sees her password. Also shown for an
 * idempotent replay of the same create (the invitation already exists).
 */
export function InvitationSentDialog({ email, onClose }: InvitationSentDialogProps) {
  const { t } = useTranslation(['admin', 'common'])
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-10 bg-success-soft text-success-strong"
          >
            <Mail size={18} />
          </span>
          {t('invitation.sentTitle')}
        </span>
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common:actions.done')}
        </Button>
      }
    >
      <p className="m-0 text-15 leading-[1.5] text-ink">
        <Trans
          t={t}
          i18nKey="invitation.sentTo"
          values={{ email }}
          components={{ strong: <span className="font-semibold" /> }}
        />{' '}
        {invitationExpirySentence()}
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-14 text-ink-2">
        {INVITATION_STEPS.map((step) => {
          const Icon = STEP_ICON[step.icon]
          return (
            <li key={step.key} className="flex items-center gap-2.5">
              <Icon size={16} aria-hidden="true" className="shrink-0 text-muted" />
              {step.text}
            </li>
          )
        })}
      </ul>
      <p className="m-0 text-13 text-muted">{invitationSentFootnote()}</p>
    </Dialog>
  )
}
