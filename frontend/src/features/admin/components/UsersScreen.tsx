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
  type UrlStateChangeOptions,
  type UsersUrlState,
} from '../model'
import { useAdminLive, useAdminTeams, useAdminUser, useAdminUsers } from '../hooks'
import type { CreatedUser, PasswordResetResult } from '../types'
import { CreateUserDialog } from './CreateUserDialog'
import { TemporaryPasswordDialog, type TemporaryPasswordResult } from './TemporaryPasswordDialog'
import { UserPanel } from './UserPanel'
import { UsersTable } from './UsersTable'
import { UsersToolbar } from './UsersToolbar'
import { ResetPasswordDialog } from './ResetPasswordDialog'

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
 * dialog (`?rol=&estado=&equipo=&idioma=&q=&persona=&nueva=`). Temporary
 * passwords live only in this component's state.
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
  const [password, setPassword] = useState<(TemporaryPasswordResult & { staffId: string }) | null>(
    null,
  )
  const [resetAfterReplay, setResetAfterReplay] = useState<string | null>(null)

  const replace = useCallback(
    (patch: Partial<UsersUrlState>) => onStateChange(patch, { replace: true }),
    [onStateChange],
  )

  // "Nuevo usuario" with the list filtered by one active team: that team is preselected.
  const onlyTeam = state.teamIds.length === 1 ? state.teamIds[0] : undefined
  const filteredTeam = onlyTeam ? teams.find((team) => team.id === onlyTeam) : undefined
  const initialTeamId = filteredTeam?.active ? filteredTeam.id : null

  function onCreated(result: CreatedUser) {
    onStateChange({ create: false, staffId: result.user.id })
    setPassword({
      kind: 'created',
      name: result.user.name,
      password: result.temporaryPassword,
      staffId: result.user.id,
    })
  }

  function onPasswordReset(name: string, result: PasswordResetResult) {
    setPassword({
      kind: 'reset',
      name,
      password: result.temporaryPassword,
      staffId: result.user.id,
    })
  }

  const replayed = password && password.password === null ? password : null
  const replayedUser = useAdminUser(resetAfterReplay).data

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
          onPasswordReset={onPasswordReset}
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

      {password ? (
        <TemporaryPasswordDialog
          result={password}
          onClose={() => setPassword(null)}
          onResetPassword={
            replayed
              ? () => {
                  setPassword(null)
                  setResetAfterReplay(replayed.staffId)
                }
              : undefined
          }
        />
      ) : null}

      {replayedUser ? (
        <ResetPasswordDialog
          user={replayedUser}
          onClose={() => setResetAfterReplay(null)}
          onDone={(result) => {
            setResetAfterReplay(null)
            onPasswordReset(replayedUser.name, result)
          }}
        />
      ) : null}
    </Page>
  )
}
