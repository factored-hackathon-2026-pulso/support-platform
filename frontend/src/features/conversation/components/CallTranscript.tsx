import { cn } from '@/lib/cn'
import { callOffset, type TranscriptItem } from '../model'

export interface CallTranscriptProps {
  items: readonly TranscriptItem[]
  /** Start of the call (`liveSince`), else the first line. */
  startedAt: string | null
}

const WHO: Partial<Record<TranscriptItem['variant'], string>> = {
  own: 'Tú',
  analyst: 'Analista',
  customer: 'Cliente',
  bot: 'Asistente',
}

/**
 * Phone layout (read-only seam until calls are functional): the transcript as a
 * timed list, as in the canvas `llamada` / `espera` / `saliente` states.
 */
export function CallTranscript({ items, startedAt }: CallTranscriptProps) {
  const lines = items.filter((item) => item.variant !== 'routing')
  const origin = startedAt ?? lines[0]?.createdAt ?? null
  if (lines.length === 0) {
    return (
      <p className="m-0 text-14 text-ink-2">
        Todavía no hay transcripción: la llamada no ha empezado.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <ol
        aria-label="Transcripción de la llamada"
        className="m-0 flex list-none flex-col gap-3 p-0"
      >
        {lines.map((item) => {
          const system = item.variant === 'notice'
          return (
            <li
              key={item.key}
              className="grid grid-cols-[48px_64px_minmax(0,1fr)] items-baseline gap-2"
            >
              <span className="font-mono text-12 text-muted">
                {origin ? callOffset(item.createdAt, origin) : ''}
              </span>
              <span
                className={cn(
                  'text-12 font-semibold',
                  item.variant === 'own' ? 'text-accent' : 'text-ink',
                )}
              >
                {system ? '' : (WHO[item.variant] ?? item.author)}
              </span>
              <span
                className={cn(
                  'text-15 leading-[1.45] whitespace-pre-line',
                  system ? 'text-muted' : 'text-ink',
                )}
              >
                {item.text}
              </span>
            </li>
          )
        })}
      </ol>
      <span className="text-12 text-muted">
        Transcripción automática · se guarda como turnos del caso
      </span>
    </div>
  )
}
