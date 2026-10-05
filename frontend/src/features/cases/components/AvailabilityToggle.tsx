import { Pause, Play } from 'lucide-react'
import { useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import { useAvailability, useUpdateAvailability } from '../hooks'
import { availabilityControlCopy } from '../model'

const pill =
  'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-13 font-semibold text-ink'

export interface AvailabilityToggleProps {
  /**
   * `header`: the loading and error states next to the "Casos" title; `banner`: the
   * full-width availability control under it (both states, once loaded).
   */
  placement: 'header' | 'banner'
}

/**
 * The availability control at the top of "Casos" (slice 6 §4.3): it is also the
 * pause indicator, so there is no separate banner. Both states share one
 * full-width block with an icon and two lines: paused is orange with a pause icon
 * ("En pausa", "No te llegan casos nuevos"); available is green with a play icon
 * ("Disponible", "Te llegan casos nuevos"). One click toggles; the accessible name
 * states the action ("En pausa. Volver a disponible").
 */
export function AvailabilityToggle({ placement }: AvailabilityToggleProps) {
  const { t } = useTranslation(['cases', 'common'])
  const availability = useAvailability()
  const update = useUpdateAvailability()
  const { toast } = useToast()

  if (availability.status === 'pending') {
    return placement === 'header' ? (
      <span className={cn(pill, 'text-muted')} aria-busy="true">
        <span aria-hidden="true" className="size-2 rounded-full bg-offline" />
        {t('availability.loading')}
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
        {t('availability.unknown')}
        <span className="sr-only">. {t('common:actions.retry')}</span>
      </button>
    ) : null
  }

  const paused = availability.data.status === 'paused'
  if (placement !== 'banner') return null
  const copy = availabilityControlCopy(availability.data.status)
  const toggle = () =>
    update.mutate(paused ? 'available' : 'paused', {
      onError: () =>
        toast({
          title: t('availability.failedTitle'),
          description: t('availability.failedDetail'),
          politeness: 'alert',
        }),
    })

  const Icon = paused ? Pause : Play
  return (
    <button
      type="button"
      aria-label={copy.accessibleName}
      onClick={toggle}
      disabled={update.isPending}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-10 px-3.5 py-2.5 text-left text-white disabled:cursor-wait',
        paused ? 'bg-warn hover:bg-warn-strong' : 'bg-success hover:bg-success-strong',
      )}
    >
      <Icon size={18} aria-hidden="true" className="shrink-0" fill="currentColor" />
      <span className="flex min-w-0 flex-col">
        <span className="text-15 font-bold">{copy.label}</span>
        <span className="text-12">{copy.detail}</span>
      </span>
    </button>
  )
}
