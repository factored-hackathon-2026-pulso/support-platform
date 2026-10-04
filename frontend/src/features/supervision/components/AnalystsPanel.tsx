import { Flame } from 'lucide-react'
import {
  Badge,
  Button,
  QueryState,
  Skeleton,
  Status,
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
  ACTIVITY_META,
  NO_SESSION_HINT,
  RECENT_RATING_HEADER,
  analystsFigures,
  atRiskCount,
  isHighLoad,
  languageWord,
  longestWait,
  openCasesCell,
  showsNoSessionHint,
  toReplyCount,
} from '../model'
import type { TeamAnalyst, TeamOverview } from '../types'
import { AnalystAvatar } from './AnalystAvatar'
import { RecentRating } from './RecentRating'

export interface AnalystsPanelProps {
  query: QueryLike<TeamOverview>
  /** The analysts that pass the filters (server order: activity, then name). */
  analysts: readonly TeamAnalyst[]
  /** Some filter is on: an empty result offers "Limpiar filtros". */
  filtered: boolean
  selectedAnalystId: string | null
  now: number
  onSelectAnalyst(analystId: string): void
  onClearFilters(): void
}

/**
 * "Analistas" (SuTeam, slice 9): one table of every analyst, whatever the team (the team
 * is a filter, never a tab): what each one is doing now, her languages and her load.
 * Selecting a row opens her sheet (`?analyst=`).
 */
export function AnalystsPanel({
  query,
  analysts,
  filtered,
  selectedAnalystId,
  now,
  onSelectAnalyst,
  onClearFilters,
}: AnalystsPanelProps) {
  const figures = analystsFigures(analysts, now)
  return (
    <section
      aria-labelledby="analysts-heading"
      className="flex min-h-0 flex-col overflow-hidden rounded-12 border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3.5 pb-2.5">
        <h2 id="analysts-heading" className="m-0 text-16 font-semibold">
          Analistas
        </h2>
        {query.data ? (
          <>
            <span className="text-13 text-muted">{figures.open}</span>
            {figures.atRisk > 0 ? (
              <span className="inline-flex items-center gap-1 text-13 font-semibold text-warn">
                <Flame size={13} aria-hidden="true" />
                {figures.atRisk} en riesgo
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <QueryState
        query={query}
        skeleton={<RowsSkeleton />}
        errorTitle="No pudimos cargar el equipo"
      >
        {() => {
          if (analysts.length === 0) {
            return (
              <div className="flex flex-col items-center gap-2 border-t border-border-soft px-4 py-8 text-14 text-muted">
                <span>{filtered ? 'Nadie coincide con los filtros.' : 'No hay analistas.'}</span>
                {filtered ? (
                  <Button size="sm" variant="secondary" onClick={onClearFilters}>
                    Limpiar filtros
                  </Button>
                ) : null}
              </div>
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
                    En riesgo
                  </TH>
                  <TH align="right" className={NUMERIC_HEADER} title={RECENT_RATING_HEADER.title}>
                    {RECENT_RATING_HEADER.label}
                  </TH>
                </TRow>
              </THead>
              <TBody>
                {analysts.map((analyst) => (
                  <AnalystRow
                    key={analyst.id}
                    analyst={analyst}
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
    </section>
  )
}

/** Eight columns: tighter side padding, long numeric headers wrap (no scroll at 1280). */
const CELL_X = 'px-3'
const NUMERIC_HEADER = 'px-3 whitespace-normal leading-tight min-w-[72px]'

interface AnalystRowProps {
  analyst: TeamAnalyst
  selected: boolean
  now: number
  onSelect(): void
}

function AnalystRow({ analyst, selected, now, onSelect }: AnalystRowProps) {
  const atRisk = atRiskCount(analyst.openCases, now)
  return (
    <TRow selected={selected} onSelect={onSelect}>
      <TCell className={cn(CELL_X, 'max-w-[240px]')}>
        <span className="flex min-w-0 items-center gap-2.5 py-1">
          <AnalystAvatar name={analyst.name} />
          <TRowSelect className="truncate">{analyst.name}</TRowSelect>
        </span>
      </TCell>
      <TCell muted className={CELL_X}>
        <span className="flex flex-wrap items-center gap-x-2">
          <Status {...ACTIVITY_META[analyst.activity]} />
          {showsNoSessionHint(analyst) ? (
            <span className="text-12 text-muted" title={NO_SESSION_HINT.title}>
              {NO_SESSION_HINT.label}
            </span>
          ) : null}
        </span>
      </TCell>
      <TCell className={CELL_X}>
        <span className="flex flex-wrap gap-1">
          {analyst.languages.map((language) => (
            <Badge key={language} tone={language === 'pt' ? 'accent' : 'neutral'} size="sm">
              {languageWord(language)}
            </Badge>
          ))}
        </span>
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
        {atRisk > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Flame size={13} aria-hidden="true" />
            {atRisk}
          </span>
        ) : (
          '—'
        )}
      </TCell>
      <TCell align="right" className={cn(CELL_X, 'whitespace-nowrap')}>
        <RecentRating stats={analyst.recentRatings} />
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
