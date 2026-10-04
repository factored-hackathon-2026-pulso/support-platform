import { Plus, UsersRound } from 'lucide-react'
import { Page, PageBody } from '@/components/layout'
import {
  Button,
  EmptyState,
  FilterChips,
  FilterMenu,
  PageHeader,
  QueryState,
  Skeleton,
  SourceNote,
  Status,
  TBody,
  TCell,
  TH,
  THead,
  TRow,
  TRowSelect,
  Table,
  activeFilterChips,
  toggleFilter,
} from '@/components/ui'
import {
  teamFilterGroups,
  teamFilterSelection,
  teamStatus,
  teamsPatchOfSelection,
  teamsQueryStatus,
  teamsShownLabel,
  teamsSubtitle,
  type TeamsUrlState,
  type UrlStateChangeOptions,
} from '../model'
import { useAdminLive, useAdminTeams } from '../hooks'
import type { AdminTeam } from '../types'
import { CreateTeamDialog } from './CreateTeamDialog'
import { TeamPanel } from './TeamPanel'

export interface TeamsScreenProps {
  state: TeamsUrlState
  onStateChange(patch: Partial<TeamsUrlState>, options?: UrlStateChangeOptions): void
}

/**
 * Equipos (contract §10.5): the teams with their people and analysts, and the
 * selected team's aside (rename, members, "Agregar persona", deactivate /
 * reactivate). One "Filtros" dropdown (Estado: Activos, Inactivos, with counts)
 * and its removable chips, never a row of pills (slice 9 rule); states are glyph +
 * word (`Status`). The URL holds the checked states, the selection and the create
 * dialog (`?estado=&equipo=&nuevo=`).
 */
export function TeamsScreen({ state, onStateChange }: TeamsScreenProps) {
  useAdminLive()
  const list = useAdminTeams(teamsQueryStatus(state.statuses))
  // The subtitle counts every team, whatever the filter.
  const total = list.data?.statusCounts.all
  const groups = teamFilterGroups(list.data?.statusCounts)
  const selection = teamFilterSelection(state)
  const replace = (patch: Partial<TeamsUrlState>) => onStateChange(patch, { replace: true })
  const toggle = (group: string, value: string) =>
    replace(teamsPatchOfSelection(toggleFilter(selection, group, value)))
  const clear = () => replace({ statuses: [] })
  const chips = activeFilterChips(groups, selection)
  const shown = list.data?.items.length

  return (
    <Page
      header={
        <PageHeader
          title="Equipos"
          subtitle={teamsSubtitle(total)}
          actions={
            <Button
              variant="primary"
              icon={<Plus size={16} aria-hidden="true" />}
              onClick={() => onStateChange({ create: true })}
            >
              Nuevo equipo
            </Button>
          }
        />
      }
      toolbar={
        <div className="flex shrink-0 flex-col gap-2 border-b border-border px-7 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <FilterMenu groups={groups} selection={selection} onToggle={toggle} onClear={clear} />
            {shown !== undefined && total !== undefined ? (
              <span className="ml-auto text-13 text-muted">{teamsShownLabel(shown, total)}</span>
            ) : null}
          </div>
          <FilterChips chips={chips} onRemove={toggle} onClear={clear} />
        </div>
      }
    >
      <PageBody scroll={false} padded={false} className="flex">
        <section aria-label="Equipos" className="flex min-w-0 grow flex-col">
          <div className="flex min-h-0 grow flex-col [&>[role=alert]]:mx-7 [&>[role=alert]]:my-4">
            <QueryState
              query={list}
              skeleton={<RowsSkeleton />}
              errorTitle="No pudimos cargar los equipos"
              isEmpty={(data) => data.items.length === 0}
              empty={
                <EmptyState
                  size="compact"
                  icon={<UsersRound size={36} strokeWidth={1.6} />}
                  title="No hay equipos en este estado."
                />
              }
            >
              {(data) => (
                <Table aria-label="Equipos" stickyHeader wrapperClassName="grow">
                  <THead>
                    <TRow>
                      <TH className="pl-7">Equipo</TH>
                      <TH align="right" className="w-[110px]">
                        Personas
                      </TH>
                      <TH align="right" className="w-[110px]">
                        Analistas
                      </TH>
                      <TH className="w-[120px] pr-7">Estado</TH>
                    </TRow>
                  </THead>
                  <TBody>
                    {data.items.map((team) => (
                      <TeamRow
                        key={team.id}
                        team={team}
                        selected={team.id === state.teamId}
                        onSelect={() => onStateChange({ teamId: team.id })}
                      />
                    ))}
                  </TBody>
                </Table>
              )}
            </QueryState>
          </div>
          <SourceNote className="px-7">
            Equipos y personas: directorio de la plataforma (datos de ejemplo).
          </SourceNote>
        </section>
        <TeamPanel teamId={state.teamId} />
      </PageBody>

      {state.create ? (
        <CreateTeamDialog
          onClose={() => onStateChange({ create: false }, { replace: true })}
          onCreated={(team) => onStateChange({ create: false, teamId: team.id })}
        />
      ) : null}
    </Page>
  )
}

function TeamRow({
  team,
  selected,
  onSelect,
}: {
  team: AdminTeam
  selected: boolean
  onSelect(): void
}) {
  return (
    <TRow selected={selected} onSelect={onSelect}>
      <TCell className="max-w-[360px] pl-7">
        <TRowSelect className="truncate">{team.name}</TRowSelect>
      </TCell>
      <TCell align="right">{team.memberCount}</TCell>
      <TCell align="right">{team.analystCount}</TCell>
      <TCell className="pr-7">
        <Status {...teamStatus(team)} />
      </TCell>
    </TRow>
  )
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-7 py-3">
      {[0, 1, 2].map((key) => (
        <Skeleton key={key} className="h-9 w-full" />
      ))}
    </div>
  )
}
