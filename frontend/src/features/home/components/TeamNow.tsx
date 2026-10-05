import { Fact, FACT_ICONS, LanguageMarks, Skeleton } from '@/components/ui'
import { TEAM_PAUSED_NOTE, teamRows } from '../model'
import type { HomeTeam } from '../types'

export interface TeamNowProps {
  team: HomeTeam | undefined
  /** The home failed to load (the feed shows the error and its retry). */
  failed: boolean
  meAvailable: boolean
  now: number
  /** Slice 21 (AI on): conversations of her languages the assistant holds now. */
  withAssistant?: number | null
}

/**
 * "Tu equipo ahora" (canvas `team`): how many of her team are available (a
 * count, no names) and, per language she speaks (its mark), how many cases wait
 * in that queue and the oldest wait (its own clock fact). Nobody else's cases.
 */
export function TeamNow({ team, failed, meAvailable, now, withAssistant = null }: TeamNowProps) {
  return (
    <section
      aria-labelledby="home-team"
      className="flex flex-col gap-2.5 rounded-14 bg-panel px-5 py-4"
    >
      <h2 id="home-team" className="m-0 text-17 font-semibold">
        Tu equipo ahora
      </h2>
      {team ? (
        <>
          <dl className="m-0 flex flex-col gap-2.5">
            {teamRows(team, meAvailable, now, withAssistant).map((row) => {
              const Icon = FACT_ICONS[row.icon]
              return (
                <div key={row.key} className="flex items-center justify-between gap-3 text-14">
                  <dt className="flex items-center gap-1.5 text-ink-2">
                    {row.language ? (
                      <LanguageMarks languages={[row.language]} />
                    ) : (
                      <Icon size={15} aria-hidden="true" />
                    )}
                    {row.label}
                  </dt>
                  <dd className="m-0 flex items-center gap-2.5">
                    <span className="font-semibold tabular-nums">{row.value}</span>
                    {row.tag ? (
                      <span className="rounded-full bg-success-soft px-1.5 text-11 font-semibold text-success-strong">
                        {row.tag}
                      </span>
                    ) : null}
                    {row.wait ? (
                      <Fact
                        icon={row.wait.icon}
                        text={row.wait.text}
                        label={row.wait.label}
                        tooltip={row.wait.tooltip}
                        tone={row.wait.tone}
                      />
                    ) : null}
                  </dd>
                </div>
              )
            })}
          </dl>
          {meAvailable ? null : <p className="m-0 text-12 text-ink-2">{TEAM_PAUSED_NOTE}</p>}
        </>
      ) : failed ? (
        <p className="m-0 text-14 text-ink-2">Sin datos del equipo por ahora.</p>
      ) : (
        <div aria-busy="true" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      )}
    </section>
  )
}
