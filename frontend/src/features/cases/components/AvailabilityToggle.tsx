import { useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useAvailability, useUpdateAvailability } from '../hooks'

const pill =
  'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-13 font-semibold text-ink'

/**
 * "Disponible" / "En pausa" pill next to the "Casos" title. One click toggles;
 * while paused no new cases are assigned ("Los que ya tienes siguen contigo").
 */
export function AvailabilityToggle() {
  const availability = useAvailability()
  const update = useUpdateAvailability()
  const { toast } = useToast()

  if (availability.status === 'pending') {
    return (
      <span className={cn(pill, 'text-muted')} aria-busy="true">
        <span aria-hidden="true" className="size-2 rounded-full bg-offline" />
        Estado…
      </span>
    )
  }

  if (availability.status === 'error') {
    return (
      <button
        type="button"
        className={cn(pill, 'cursor-pointer text-ink-2 hover:bg-subtle')}
        onClick={() => void availability.refetch()}
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-offline" />
        Sin estado<span className="sr-only">. Reintentar</span>
      </button>
    )
  }

  const paused = availability.data.status === 'paused'
  const toggle = () =>
    update.mutate(paused ? 'available' : 'paused', {
      onError: () =>
        toast({
          title: 'No pudimos cambiar tu estado',
          description: 'Revisa tu conexión e inténtalo de nuevo.',
          politeness: 'alert',
        }),
    })

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={update.isPending}
      className={cn(pill, 'cursor-pointer hover:bg-subtle disabled:cursor-wait')}
    >
      <span
        aria-hidden="true"
        className={cn('size-2 rounded-full', paused ? 'bg-warn' : 'bg-success')}
      />
      {paused ? 'En pausa' : 'Disponible'}
      <span className="sr-only">{paused ? '. Volver a disponible' : '. Pausar casos nuevos'}</span>
    </button>
  )
}
