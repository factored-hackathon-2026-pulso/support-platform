import { Plus, UsersRound } from 'lucide-react'
import { Page, PageBody } from '@/components/layout'
import {
  Button,
  EmptyState,
  PageHeader,
  QueryState,
  SegmentedControl,
  Skeleton,
  SourceNote,
  TBody,
  TCell,
  TH,
  THead,
  TRow,
  TRowSelect,
  Table,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  teamStatusLabel,
  teamsSubtitle,
  type TeamsUrlState,
  type UrlStateChangeOptions,
} from '../model'
import { useAdminLive, useAdminTeams } from '../hooks'
import type { AdminTeam, TeamStatusFilter } from '../types'
import { CreateTeamDialog } from './CreateTeamDialog'
import { TeamPanel } from './TeamPanel'

export interface TeamsScreenProps {
  state: TeamsUrlState
  onStateChange(patch: Partial<TeamsUrlState>, options?: UrlStateChangeOptions): void
}

/**
 * Equipos (contract §10.5): the teams with their people and analysts, and the
 * selected team's aside (rename, members, "Agregar persona", deactivate /
 * reactivate). The URL holds the status pill, the selection and the create
 * dialog (`?estado=&equipo=&nuevo=`).
 */
export function TeamsScreen({ state, onStateChange }: TeamsScreenProps) {
  useAdminLive()
  const list = useAdminTeams(state.status)
  // The subtitle counts every team, whatever pill is selected.
  const total = list.data?.statusCounts.all

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
        <div className="flex shrink-0 items-center border-b border-border px-7 py-3">
          <SegmentedControl<TeamStatusFilter>
            label="Estado"
            variant="pills"
            value={state.status}
            onValueChange={(status) => onStateChange({ status }, { replace: true })}
            options={[
              { value: 'active', label: 'Activos', count: list.data?.statusCounts.active },
              { value: 'inactive', label: 'Inactivos', count: list.data?.statusCounts.inactive },
              { value: 'all', label: 'Todos', count: list.data?.statusCounts.all },
            ]}
          />
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
      <TCell className={cn('pr-7 text-13', team.active ? 'text-ink-2' : 'text-muted')}>
        {teamStatusLabel(team)}
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
