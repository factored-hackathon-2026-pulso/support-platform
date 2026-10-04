import { Link } from 'react-router'
import { StatusIcon, toneBorderLeft } from '@/components/ui'
import type { InboxCounts } from '@/features/cases'
import { cn } from '@/lib/cn'
import { CLOSED_TILE_HINT, statusTiles } from '../model'

/**
 * The four status counters (canvas `tiles`): Por responder · Nuevos · Esperando
 * al cliente · Cerrados (last 7 days), each a link to Casos with that filter
 * (`/analyst/cases?status=…`). The Casos list itself has no tiles (slice 6 §4.3).
 */
export function StatusTiles({ counts }: { counts: InboxCounts | undefined }) {
  return (
    <nav aria-label="Tus casos por estado">
      <ul className="m-0 grid list-none grid-cols-4 gap-3 p-0">
        {statusTiles(counts).map((tile) => {
          const hint = tile.status === 'closed' ? CLOSED_TILE_HINT : null
          return (
            <li key={tile.status}>
              <Link
                to={tile.href}
                aria-label={`${tile.count ?? 'Sin dato de'} ${tile.label}${hint ? `, ${hint.toLowerCase()}` : ''}. Ver en Casos`}
                className={cn(
                  'flex h-full flex-col gap-0.5 rounded-12 border border-l-4 border-border bg-surface px-4 py-3 text-ink transition-colors hover:border-ink-2',
                  toneBorderLeft[tile.tone],
                )}
              >
                <span className="font-display text-26 font-bold tabular-nums" aria-hidden="true">
                  {tile.count ?? '–'}
                </span>
                <span className="flex items-center gap-2" aria-hidden="true">
                  <span className="flex items-center gap-1.5 text-14 text-ink-2">
                    <StatusIcon shape={tile.shape} tone={tile.tone} />
                    {tile.label}
                  </span>
                  {hint ? <span className="text-12 text-muted">{hint}</span> : null}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
