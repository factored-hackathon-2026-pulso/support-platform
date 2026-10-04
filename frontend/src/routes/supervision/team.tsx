import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { supervisionCasePath } from '@/app/roles'
import {
  TeamScreen,
  parseTeamSearch,
  toTeamSearch,
  type TeamUrlState,
  type UrlStateChangeOptions,
} from '@/features/supervision'

/**
 * /supervision/equipo — "Equipo". Shareable state lives in the URL:
 * `?estado=&idioma=&equipo=&analista=&reasignar=` (slice 9). Opening a
 * case hands the full return URL (filters included) to the case view.
 */
export default function TeamRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const state = useMemo(() => parseTeamSearch(searchParams), [searchParams])

  const onStateChange = useCallback(
    (patch: Partial<TeamUrlState>, options?: UrlStateChangeOptions) => {
      setSearchParams((current) => toTeamSearch({ ...parseTeamSearch(current), ...patch }), {
        replace: options?.replace ?? false,
      })
    },
    [setSearchParams],
  )

  const from = `${location.pathname}${location.search}`
  const onOpenCase = useCallback(
    (caseId: string) => void navigate(supervisionCasePath(caseId), { state: { from } }),
    [navigate, from],
  )

  return <TeamScreen state={state} onStateChange={onStateChange} onOpenCase={onOpenCase} />
}
