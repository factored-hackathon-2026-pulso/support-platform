import { Mail, MessageSquare, Phone, type LucideIcon } from 'lucide-react'
import { Callout, cardClasses } from '@/components/ui'
import { cn } from '@/lib/cn'
import { CHANNEL_OPTIONS, type SimChannel } from '../channels'

const ICONS: Record<SimChannel, LucideIcon> = {
  chat: MessageSquare,
  call: Phone,
  mail: Mail,
}

export interface ChannelPickerProps {
  firstName: string
  /** The channel being opened (its card shows a busy state: "Llamar" starts the call). */
  busy: SimChannel | null
  error: string | null
  onPick(channel: SimChannel): void
}

/**
 * "¿Cómo se comunica {nombre} con el banco?" (slice 12, Main.dc.html "canal"): Chat, Llamar
 * or Escribir un correo, as three cards with their icon.
 */
export function ChannelPicker({ firstName, busy, error, onPick }: ChannelPickerProps) {
  return (
    <section
      aria-labelledby="canal-title"
      className="mx-auto flex w-full max-w-[880px] flex-col gap-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="canal-title" className="m-0 font-display text-20 font-bold">
          ¿Cómo se comunica {firstName} con el banco?
        </h2>
        <p className="m-0 text-14 text-ink-2">
          El caso le llega a alguien disponible del equipo que hable su idioma, por el canal que
          elijas.
        </p>
      </div>
      {error ? (
        <Callout tone="danger" title="No se pudo llamar">
          {error}
        </Callout>
      ) : null}
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3">
        {CHANNEL_OPTIONS.map((option) => {
          const Icon = ICONS[option.value]
          const working = busy === option.value
          return (
            <li key={option.value}>
              <button
                type="button"
                aria-busy={working || undefined}
                aria-disabled={busy !== null || undefined}
                onClick={() => {
                  if (busy === null) onPick(option.value)
                }}
                className={cn(
                  cardClasses({ padding: 'lg', interactive: true }),
                  'flex min-h-[148px] w-full cursor-pointer flex-col items-start gap-3.5 text-left aria-disabled:cursor-wait',
                  working && 'border-ink',
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-12 items-center justify-center rounded-12 bg-app-rate-good text-app-brand"
                >
                  <Icon size={22} />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-17 font-semibold text-ink">{option.title}</span>
                  <span className="text-14 text-ink-2">{option.description}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
