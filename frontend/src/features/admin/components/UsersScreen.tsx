import { useCallback, useMemo, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Page, PageBody } from '@/components/layout'
import { Button, PageHeader } from '@/components/ui'
import { useNow } from '@/lib/hooks'
import {
  clearUserFilters,
  filterUsers,
  hasUserFilters,
  userFilterGroups,
  userFilterSelection,
  usersQueryOf,
  usersSubtitle,
} from '../model'
import type { UrlStateChangeOptions, UsersUrlState } from '../url'
import { useAdminLive, useAdminTeams, useAdminUsers } from '../hooks'
import type { InvitedUser } from '../types'
import { CreateUserDialog } from './CreateUserDialog'
import { InvitationSentDialog } from './InvitationSentDialog'
import { UserPanel } from './UserPanel'
import { UsersTable } from './UsersTable'
import { UsersToolbar } from './UsersToolbar'

/** Clock of the account statuses (a lock expires on its own) and "Último ingreso". */
export const USERS_TICK_MS = 15_000

export interface UsersScreenProps {
  state: UsersUrlState
  onStateChange(patch: Partial<UsersUrlState>, options?: UrlStateChangeOptions): void
  /** The viewer also holds Supervisión: open-case blocks link to supervision. */
  canOpenSupervision: boolean
}

/**
 * Usuarios y roles (Admin.dc.html section `usuarios`, contract §10.2): the
 * directory with its filters and the selected person's aside, live through
 * `admin:directory`. The URL holds the filters, the selection and the create
 * dialog (`?role=&status=&team=&language=&q=&person=&new=`). Part 4: creating a
 * person sends her an invitation by email ("Invitación enviada"); no password is
 * ever shown to administration.
 */
export function UsersScreen({ state, onStateChange, canOpenSupervision }: UsersScreenProps) {
  useAdminLive()
  const now = useNow(USERS_TICK_MS)
  const filters = useMemo(() => usersQueryOf(state), [state])
  const users = useAdminUsers(filters)
  const teamsQuery = useAdminTeams('all')
  const teams = useMemo(() => teamsQuery.data?.items ?? [], [teamsQuery.data])
  // The groups filter here, over the people the search found (`usersQueryOf`).
  const selection = useMemo(() => userFilterSelection(state), [state])
  const found = users.data?.items
  const groups = useMemo(
    () => userFilterGroups(found ?? [], teams, selection, now),
    [found, teams, selection, now],
  )
  const shown = useMemo(
    () => (found ? filterUsers(found, selection, now) : undefined),
    [found, selection, now],
  )
  const listQuery = useMemo(
    () => ({
      ...users,
      data: users.data && shown ? { ...users.data, items: shown } : users.data,
    }),
    [users, shown],
  )
  /** The address of the invitation just sent (the "Invitación enviada" dialog). */
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null)

  const replace = useCallback(
    (patch: Partial<UsersUrlState>) => onStateChange(patch, { replace: true }),
    [onStateChange],
  )

  // "Nuevo usuario" with the list filtered by one active team: that team is preselected.
  const onlyTeam = state.teamIds.length === 1 ? state.teamIds[0] : undefined
  const filteredTeam = onlyTeam ? teams.find((team) => team.id === onlyTeam) : undefined
  const initialTeamId = filteredTeam?.active ? filteredTeam.id : null

  function onCreated(result: InvitedUser) {
    onStateChange({ create: false, staffId: result.user.id })
    setInvitedEmail(result.user.email)
  }

  return (
    <Page
      header={
        <PageHeader
          title="Usuarios y roles"
          subtitle={usersSubtitle(users.data?.statusCounts.all)}
          actions={
            <Button
              variant="primary"
              icon={<UserPlus size={16} aria-hidden="true" />}
              onClick={() => onStateChange({ create: true })}
            >
              Nuevo usuario
            </Button>
          }
        />
      }
      toolbar={
        <UsersToolbar
          state={state}
          onStateChange={onStateChange}
          groups={groups}
          shown={shown?.length}
          total={found?.length}
        />
      }
    >
      <PageBody scroll={false} padded={false} className="flex">
        <UsersTable
          query={listQuery}
          selectedId={state.staffId}
          filtered={hasUserFilters(state)}
          now={now}
          onSelect={(staffId) => onStateChange({ staffId })}
          onClearFilters={() => replace(clearUserFilters(state))}
        />
        <UserPanel
          staffId={state.staffId}
          teams={teams}
          now={now}
          canOpenSupervision={canOpenSupervision}
          onInvitationCancelled={() => onStateChange({ staffId: null }, { replace: true })}
        />
      </PageBody>

      {state.create ? (
        <CreateUserDialog
          teams={teams}
          initialTeamId={initialTeamId}
          onClose={() => onStateChange({ create: false }, { replace: true })}
          onCreated={onCreated}
        />
      ) : null}

      {invitedEmail ? (
        <InvitationSentDialog email={invitedEmail} onClose={() => setInvitedEmail(null)} />
      ) : null}
    </Page>
  )
}
