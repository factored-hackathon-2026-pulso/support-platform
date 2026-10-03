import {
  Badge,
  QueryState,
  SegmentedControl,
  Skeleton,
  SourceNote,
  StatusDot,
  TBody,
  TCell,
  TH,
  THead,
  TRow,
  TRowSelect,
  Table,
  type QueryLike,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  ACTIVITY_FILTERS,
  ACTIVITY_META,
  NO_SESSION_HINT,
  analystsInFilter,
  analystsOfTeam,
  analystsSummary,
  atRiskCount,
  countByFilter,
  isHighLoad,
  languagesLabel,
  longestWait,
  openCasesCell,
  showsNoSessionHint,
  teamPillLabels,
  toReplyCount,
  type ActivityFilter,
} from '../model'
import type { TeamAnalyst, TeamOverview } from '../types'

export interface AnalystsPanelProps {
  query: QueryLike<TeamOverview>
  /** `null` = every team (the row then names the team). */
  teamKey: string | null
  filter: ActivityFilter
  selectedAnalystId: string | null
  now: number
  onFilterChange(filter: ActivityFilter): void
  onSelectAnalyst(analystId: string): void
}

/**
 * "Analistas" (SuTeam, contract §8.4): the state filters (native radios), the
 * team's figures, and one row per analyst with what she is doing now and her
 * load. Selecting a row opens her sheet (`?analista=`).
 */
export function AnalystsPanel({
  query,
  teamKey,
  filter,
  selectedAnalystId,
  now,
  onFilterChange,
  onSelectAnalyst,
}: AnalystsPanelProps) {
  const ofTeam = query.data ? analystsOfTeam(query.data.analysts, teamKey) : []
  const counts = countByFilter(ofTeam)
  // The row names the team like the pills do ("Equipo Andes"): the shared prefix costs width.
  const teamLabels = query.data ? teamPillLabels(query.data.teams) : {}

  return (
    <section
      aria-labelledby="analysts-heading"
      className="flex min-h-0 flex-col overflow-hidden rounded-12 border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="analysts-heading" className="m-0 text-16 font-semibold">
            Analistas
          </h2>
          {query.data ? (
            <span className="text-13 text-muted">{analystsSummary(ofTeam, now)}</span>
          ) : null}
        </div>
        <SegmentedControl<ActivityFilter>
          label="Estado"
          variant="pills"
          value={filter}
          onValueChange={onFilterChange}
          options={ACTIVITY_FILTERS.map((option) => ({
            value: option.value,
            label: option.label,
            count: query.data ? counts[option.value] : undefined,
          }))}
        />
      </div>
      <QueryState
        query={query}
        skeleton={<RowsSkeleton />}
        errorTitle="No pudimos cargar el equipo"
      >
        {() => {
          const rows = analystsInFilter(ofTeam, filter)
          if (rows.length === 0) {
            return (
              <p className="m-0 border-t border-border-soft px-4 py-6 text-center text-14 text-muted">
                Nadie en este estado ahora.
              </p>
            )
          }
          return (
            <Table aria-labelledby="analysts-heading" stickyHeader wrapperClassName="grow">
              <THead>
                <TRow>
                  <TH className={CELL_X}>Nombre</TH>
                  <TH className={CELL_X}>Ahora</TH>
                  <TH className={CELL_X}>Idiomas</TH>
                  <TH align="right" className={CELL_X}>
                    Abiertos
                  </TH>
                  <TH align="right" className={NUMERIC_HEADER}>
                    Por responder
                  </TH>
                  <TH align="right" className={NUMERIC_HEADER}>
                    Espera más larga
                  </TH>
                  <TH align="right" className={NUMERIC_HEADER}>
                    SLA en riesgo
                  </TH>
                </TRow>
              </THead>
              <TBody>
                {rows.map((analyst) => (
                  <AnalystRow
                    key={analyst.id}
                    analyst={analyst}
                    teamLabel={
                      teamKey === null ? (teamLabels[analyst.team.key] ?? analyst.team.name) : null
                    }
                    selected={analyst.id === selectedAnalystId}
                    now={now}
                    onSelect={() => onSelectAnalyst(analyst.id)}
                  />
                ))}
              </TBody>
            </Table>
          )
        }}
      </QueryState>
      <SourceNote>
        Personas, idiomas y equipos: directorio del equipo. Estado, colas y casos: datos de ejemplo.
      </SourceNote>
    </section>
  )
}

/**
 * Seven columns share the right column (~860 px at 1440, ~700 px at 1280): tighter
 * side padding than the table default, and the long numeric headers wrap to two
 * lines, so every column stays visible without a horizontal scroll.
 */
const CELL_X = 'px-3'
const NUMERIC_HEADER = 'px-3 whitespace-normal leading-tight min-w-[72px]'

interface AnalystRowProps {
  analyst: TeamAnalyst
  /** The team, when every team is listed ("Todos los equipos"); null hides it. */
  teamLabel: string | null
  selected: boolean
  now: number
  onSelect(): void
}

function AnalystRow({ analyst, teamLabel, selected, now, onSelect }: AnalystRowProps) {
  const meta = ACTIVITY_META[analyst.activity]
  const atRisk = atRiskCount(analyst.openCases, now)
  const speaksPortuguese = analyst.languages.includes('pt')
  return (
    <TRow selected={selected} onSelect={onSelect}>
      <TCell className={cn(CELL_X, 'max-w-[240px]')}>
        <span className="flex min-w-0 flex-col py-1">
          <TRowSelect className="truncate">{analyst.name}</TRowSelect>
          {teamLabel ? (
            <span className="truncate text-12 text-muted" title={analyst.team.name}>
              {teamLabel}
            </span>
          ) : null}
        </span>
      </TCell>
      <TCell muted className={CELL_X}>
        <span className="flex flex-wrap items-center gap-x-1.5">
          <StatusDot tone={meta.tone} label={meta.label} />
          {showsNoSessionHint(analyst) ? (
            <span className="text-12 text-muted" title={NO_SESSION_HINT.title}>
              · {NO_SESSION_HINT.label}
            </span>
          ) : null}
        </span>
      </TCell>
      <TCell muted className={cn(CELL_X, speaksPortuguese && 'font-semibold text-accent')}>
        {languagesLabel(analyst.languages)}
      </TCell>
      <TCell align="right" className={CELL_X}>
        <span className="inline-flex items-center gap-1.5">
          {isHighLoad(analyst) ? (
            <Badge tone="warn" size="sm">
              Carga alta
            </Badge>
          ) : null}
          {openCasesCell(analyst)}
        </span>
      </TCell>
      <TCell align="right" className={CELL_X}>
        {toReplyCount(analyst)}
      </TCell>
      <TCell align="right" muted className={CELL_X}>
        {longestWait(analyst, now)}
      </TCell>
      <TCell align="right" className={cn(CELL_X, atRisk > 0 && 'font-semibold text-warn')}>
        {atRisk > 0 ? atRisk : '—'}
      </TCell>
    </TRow>
  )
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2 border-t border-border-soft px-4 py-3">
      {[0, 1, 2, 3].map((key) => (
        <Skeleton key={key} className="h-7 w-full" />
      ))}
    </div>
  )
}
