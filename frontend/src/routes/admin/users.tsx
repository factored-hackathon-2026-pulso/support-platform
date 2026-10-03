import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useSession } from '@/app/session'
import {
  UsersScreen,
  parseUsersSearch,
  toUsersSearch,
  type UrlStateChangeOptions,
  type UsersUrlState,
} from '@/features/admin'

/**
 * /administracion/usuarios — Usuarios y roles. Filters, the selected person
 * and the create dialog live in the URL
 * (`?rol=&estado=&equipo=&idioma=&q=&persona=&nueva=`, slice-4-administration.md §10.11).
 */
export default function UsersRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasRole } = useSession()
  const state = useMemo(() => parseUsersSearch(searchParams), [searchParams])

  const onStateChange = useCallback(
    (patch: Partial<UsersUrlState>, options?: UrlStateChangeOptions) => {
      setSearchParams((current) => toUsersSearch({ ...parseUsersSearch(current), ...patch }), {
        replace: options?.replace ?? false,
      })
    },
    [setSearchParams],
  )

  return (
    <UsersScreen
      state={state}
      onStateChange={onStateChange}
      canOpenSupervision={hasRole('supervisor')}
    />
  )
}
