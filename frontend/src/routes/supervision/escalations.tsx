import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { supervisionCasePath } from '@/app/roles'
import {
  EscalationsScreen,
  parseEscalationsSearch,
  toEscalationsSearch,
  type EscalationsUrlState,
  type UrlStateChangeOptions,
} from '@/features/supervision'

/**
 * /supervision/escalados — "Escalados" (slice 9). The selected escalation and the reassign
 * dialog live in the URL (`?escalamiento=&reasignar=`).
 */
export default function EscalationsRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const state = useMemo(() => parseEscalationsSearch(searchParams), [searchParams])

  const onStateChange = useCallback(
    (patch: Partial<EscalationsUrlState>, options?: UrlStateChangeOptions) => {
      setSearchParams(
        (current) => toEscalationsSearch({ ...parseEscalationsSearch(current), ...patch }),
        { replace: options?.replace ?? false },
      )
    },
    [setSearchParams],
  )

  const from = `${location.pathname}${location.search}`
  const onOpenCase = useCallback(
    (caseId: string) => void navigate(supervisionCasePath(caseId), { state: { from } }),
    [navigate, from],
  )

  return <EscalationsScreen state={state} onStateChange={onStateChange} onOpenCase={onOpenCase} />
}
