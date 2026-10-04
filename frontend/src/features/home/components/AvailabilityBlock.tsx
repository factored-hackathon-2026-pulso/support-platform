import { workspacePath } from '@/app/roles'
import { Button, FactList, LinkButton, Skeleton, useToast } from '@/components/ui'
import { useAvailability, useUpdateAvailability } from '@/features/cases'
import { cn } from '@/lib/cn'
import { availabilityBlockCopy } from '../model'

export interface AvailabilityBlockProps {
  openCases: number | null
}

/**
 * "Tu disponibilidad" (canvas `av`): paused → orange block "Estás en pausa" +
 * "Empezar a atender"; available → green block "Estás disponible" + "Pausar
 * casos nuevos"; the facts underneath are short items. Plus "Ir a Casos". Same
 * availability query and mutation as the Casos list (`availability.updated`
 * keeps both in sync).
 */
export function AvailabilityBlock({ openCases }: AvailabilityBlockProps) {
  const availability = useAvailability()
  const update = useUpdateAvailability()
  const { toast } = useToast()

  const goToCases = (
    <LinkButton to={workspacePath()} variant="secondary" size="lg">
      Ir a Casos
    </LinkButton>
  )

  if (availability.status !== 'success') {
    return (
      <section
        aria-label="Tu disponibilidad"
        aria-busy={availability.status === 'pending' || undefined}
        className="flex items-center justify-between gap-6 rounded-14 border border-border bg-surface px-6 py-5"
      >
        {availability.status === 'pending' ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-60" />
            <Skeleton className="h-4 w-80" />
          </div>
        ) : (
          <p className="m-0 text-17 font-semibold">No pudimos cargar tu estado</p>
        )}
        <div className="flex shrink-0 gap-2.5">
          {goToCases}
          {availability.status === 'error' ? (
            <Button size="lg" onClick={() => void availability.refetch()}>
              Reintentar
            </Button>
          ) : null}
        </div>
      </section>
    )
  }

  const status = availability.data.status
  const paused = status === 'paused'
  const copy = availabilityBlockCopy(status, { openCases })
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
    <section
      aria-label="Tu disponibilidad"
      className={cn(
        'flex items-center justify-between gap-6 rounded-14 border px-6 py-5',
        paused ? 'border-warn-border bg-warn-soft' : 'border-success-border bg-success-soft',
      )}
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className={cn('mt-[9px] size-3 shrink-0 rounded-full', paused ? 'bg-warn' : 'bg-success')}
        />
        <div className="flex flex-col gap-1.5">
          <p className="m-0 font-display text-22 font-bold">{copy.title}</p>
          <FactList items={copy.facts} size="md" />
        </div>
      </div>
      <div className="flex shrink-0 gap-2.5">
        {goToCases}
        <Button
          size="lg"
          variant={paused ? 'primary' : 'secondary'}
          loading={update.isPending}
          onClick={toggle}
        >
          {copy.action}
        </Button>
      </div>
    </section>
  )
}
