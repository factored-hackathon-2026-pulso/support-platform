import { useCurrentUser } from '@/app/session'
import { Badge, DocumentTitle, SampleDataTag } from '@/components/ui'
import { useAvailability, useInbox } from '@/features/cases'
import { useNow } from '@/lib/hooks'
import { useHome } from '../hooks'
import { greeting, headerLine } from '../model'
import { ActivityFeed } from './ActivityFeed'
import { AvailabilityBlock } from './AvailabilityBlock'
import { FirstCases } from './FirstCases'
import { StatusTiles } from './StatusTiles'
import { TeamNow } from './TeamNow'

/** SLA countdowns, "hace x" and the greeting tick every 30 s. */
const TICK_MS = 30_000

/**
 * The analyst home, "Inicio" (HomeTurno.dc.html, slice 6 §4): greeting, her
 * availability, the four status tiles (links to Casos with the filter), "Lo
 * primero" (her open cases by urgency), "Mientras no estabas" (what happened
 * since her previous session, fixed templates) and "Tu equipo ahora" (counts
 * only). The tiles and "Lo primero" share the inbox cache with the Casos list;
 * the rest is `GET /me/home`. Owns the `<main>` landmark.
 */
export function HomeScreen() {
  const user = useCurrentUser()
  const now = useNow(TICK_MS)
  const inbox = useInbox({ status: null, q: '' })
  const availability = useAvailability()
  const home = useHome()
  const paused = availability.data?.status !== 'available'
  const header = headerLine(now, user.team.name)

  return (
    <main className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto px-10 py-7">
      <DocumentTitle title="Inicio" />
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="m-0 flex items-center gap-2 text-13 text-muted">
            <span>{header.date}</span>
            {header.team ? (
              <Badge tone="neutral" size="sm">
                <span className="sr-only">Equipo: </span>
                {header.team}
              </Badge>
            ) : null}
          </p>
          <h1 className="m-0 font-display text-32 font-bold tracking-display">
            {greeting(user.name, now)}
          </h1>
        </div>
        <SampleDataTag />
      </header>

      <AvailabilityBlock openCases={inbox.data?.counts.all ?? null} />

      <StatusTiles counts={inbox.data?.counts} />

      <div className="grid min-h-[420px] grow grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-4">
        <FirstCases
          inbox={{
            status: inbox.status,
            data: inbox.data,
            isFetching: inbox.isFetching,
            refetch: inbox.refetch,
          }}
          now={now}
          paused={paused}
        />
        {/* The right column takes its natural height: the page scrolls, nothing is clipped. */}
        <div className="flex flex-col gap-4">
          <ActivityFeed home={home} now={now} />
          <TeamNow
            team={home.data?.teamNow}
            failed={home.status === 'error'}
            meAvailable={!paused}
            now={now}
          />
        </div>
      </div>
    </main>
  )
}
