import { Button, Callout, useToast } from '@/components/ui'
import { useAvailability, useUpdateAvailability } from '../hooks'

/** Orange banner of the `pausa` state: shown only while the analyst is paused. */
export function PausedNotice() {
  const availability = useAvailability()
  const update = useUpdateAvailability()
  const { toast } = useToast()
  if (availability.data?.status !== 'paused') return null
  return (
    <Callout
      tone="warn"
      title="En pausa · no te llegan casos nuevos"
      actions={
        <Button
          size="sm"
          loading={update.isPending}
          onClick={() =>
            update.mutate('available', {
              onError: () =>
                toast({
                  title: 'No pudimos cambiar tu estado',
                  description: 'Revisa tu conexión e inténtalo de nuevo.',
                  politeness: 'alert',
                }),
            })
          }
        >
          Volver a disponible
        </Button>
      }
    >
      Los que ya tienes siguen contigo.
    </Callout>
  )
}
