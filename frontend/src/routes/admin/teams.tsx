import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import {
  TeamsScreen,
  parseTeamsSearch,
  toTeamsSearch,
  type TeamsUrlState,
  type UrlStateChangeOptions,
} from '@/features/admin'

/**
 * /administracion/equipos — Equipos. The "Filtros" states, the selected team and
 * the create dialog live in the URL (`?estado=&equipo=&nuevo=`, slice-4-administration.md §10.11).
 */
export default function TeamsRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useMemo(() => parseTeamsSearch(searchParams), [searchParams])

  const onStateChange = useCallback(
    (patch: Partial<TeamsUrlState>, options?: UrlStateChangeOptions) => {
      setSearchParams((current) => toTeamsSearch({ ...parseTeamsSearch(current), ...patch }), {
        replace: options?.replace ?? false,
      })
    },
    [setSearchParams],
  )

  return <TeamsScreen state={state} onStateChange={onStateChange} />
}
