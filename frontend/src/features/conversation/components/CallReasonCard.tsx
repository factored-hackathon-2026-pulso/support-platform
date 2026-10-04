import { PhoneOutgoing } from 'lucide-react'

/** "Por qué llamas" (slice 12): the reason of an outbound call, above its transcript. */
export function CallReasonCard({ reason }: { reason: string }) {
  return (
    <section
      aria-label="Por qué llamas"
      className="flex items-start gap-3 rounded-12 border border-border bg-surface px-3.5 py-3"
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong"
      >
        <PhoneOutgoing size={15} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-14 font-semibold text-ink">Por qué llamas</span>
        <span className="text-14 break-words whitespace-pre-line text-ink-2">{reason}</span>
      </span>
    </section>
  )
}
