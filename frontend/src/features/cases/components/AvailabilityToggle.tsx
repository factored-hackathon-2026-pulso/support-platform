import { Pause } from 'lucide-react'
import { useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useAvailability, useUpdateAvailability } from '../hooks'
import { availabilityControlCopy } from '../model'

const pill =
  'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-13 font-semibold text-ink'

export interface AvailabilityToggleProps {
  /**
   * `header`: the discreet "Disponible" pill next to the "Casos" title (also the
   * loading and error states); `banner`: the full-width orange "En pausa" control
   * under it. Each placement renders only in its own state, so the list mounts both.
   */
  placement: 'header' | 'banner'
}

/**
 * The availability control at the top of "Casos" (slice 6 §4.3): it is also the
 * pause indicator, so there is no separate banner. Paused: a full-width orange
 * button "En pausa · No te llegan casos nuevos" (pause icon); available: a white
 * pill with a green dot, "Disponible". One click toggles; the accessible name
 * states the action ("En pausa. Volver a disponible").
 */
export function AvailabilityToggle({ placement }: AvailabilityToggleProps) {
  const availability = useAvailability()
  const update = useUpdateAvailability()
  const { toast } = useToast()

  if (availability.status === 'pending') {
    return placement === 'header' ? (
      <span className={cn(pill, 'text-muted')} aria-busy="true">
        <span aria-hidden="true" className="size-2 rounded-full bg-offline" />
        Estado…
      </span>
    ) : null
  }

  if (availability.status === 'error') {
    return placement === 'header' ? (
      <button
        type="button"
        className={cn(pill, 'cursor-pointer text-ink-2 hover:bg-subtle')}
        onClick={() => void availability.refetch()}
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-offline" />
        Sin estado<span className="sr-only">. Reintentar</span>
      </button>
    ) : null
  }

  const paused = availability.data.status === 'paused'
  if (paused !== (placement === 'banner')) return null
  const copy = availabilityControlCopy(availability.data.status)
  const toggle = () =>
    update.mutate(paused ? 'available' : 'paused', {
      onError: () =>
        toast({
          title: 'No pudimos cambiar tu estado',
          description: 'Revisa tu conexión e inténtalo de nuevo.',
          politeness: 'alert',
        }),
    })

  if (paused) {
    return (
      <button
        type="button"
        aria-label={copy.accessibleName}
        onClick={toggle}
        disabled={update.isPending}
        className="flex w-full cursor-pointer items-center gap-3 rounded-10 bg-warn px-3.5 py-2.5 text-left text-white hover:bg-warn-strong disabled:cursor-wait"
      >
        <Pause size={18} aria-hidden="true" className="shrink-0" fill="currentColor" />
        <span className="flex min-w-0 flex-col">
          <span className="text-15 font-bold">{copy.label}</span>
          <span className="text-12">{copy.detail}</span>
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label={copy.accessibleName}
      onClick={toggle}
      disabled={update.isPending}
      className={cn(pill, 'cursor-pointer hover:bg-subtle disabled:cursor-wait')}
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-success" />
      {copy.label}
    </button>
  )
}
