import { Phone, PhoneOff } from 'lucide-react'
import { customerCallCopy, isIncomingCall } from '../channels'
import { useCustomerCallCommand } from '../hooks'
import { chatLang } from '../model'
import type { CustomerCall, Language } from '../types'

export interface IncomingCallBannerProps {
  customerId: string
  call: CustomerCall | null
  language: Language
  /** After "Contestar": the simulator switches to the call. */
  onAnswered(): void
}

/**
 * "LATAM Bank te está llamando" (slice 12): a call of the bank rings over whatever channel the
 * customer is on, with "Contestar" and "Rechazar". The live region is always mounted, so the
 * ring is announced when it starts.
 */
export function IncomingCallBanner({
  customerId,
  call,
  language,
  onAnswered,
}: IncomingCallBannerProps) {
  const copy = customerCallCopy(language)
  const command = useCustomerCallCommand(customerId)
  const ringing = isIncomingCall(call)
  return (
    <div aria-live="assertive" className="mx-auto w-full max-w-[880px] empty:hidden">
      {ringing ? (
        <section
          aria-label={copy.incoming}
          lang={chatLang(language)}
          className="flex flex-wrap items-center justify-between gap-3 rounded-14 border border-app-chip-line bg-white px-4 py-3 shadow-popover"
        >
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-full bg-app-rate-good text-app-brand motion-safe:animate-pulse"
            >
              <Phone size={18} />
            </span>
            <span className="flex flex-col">
              <span className="text-15 font-semibold text-app-ink">{copy.incoming}</span>
              <span className="text-13 text-app-muted">{copy.incomingHint}</span>
            </span>
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (!command.isPending) command.mutate({ callId: call.id, command: 'reject' })
              }}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border-0 bg-danger px-4 text-14 font-semibold text-white hover:bg-danger-strong"
            >
              <PhoneOff size={15} aria-hidden="true" />
              {copy.reject}
            </button>
            <button
              type="button"
              onClick={() => {
                if (command.isPending) return
                command.mutate({ callId: call.id, command: 'answer' }, { onSuccess: onAnswered })
              }}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border-0 bg-app-brand px-4 text-14 font-semibold text-white hover:bg-app-brand-strong"
            >
              <Phone size={15} aria-hidden="true" />
              {copy.answer}
            </button>
          </span>
        </section>
      ) : null}
    </div>
  )
}
