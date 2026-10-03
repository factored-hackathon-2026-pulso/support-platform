import { useCallback, useMemo } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router'
import { ROLES } from '@/app/roles'
import { readRedirectFrom } from '@/app/redirect'
import {
  SupervisorCaseScreen,
  parseCaseViewSearch,
  toCaseViewSearch,
  type CaseViewUrlState,
  type UrlStateChangeOptions,
} from '@/features/supervision'

const AUDIT_PATH = '/supervision/auditoria'

/**
 * /supervision/casos/:caseId — the supervisor's read-only case view
 * (slice-3-supervision.md §8.5). `?historial=&asignar=` live in the URL; the
 * screen it came from arrives as `state.from` (one-shot hand-off, kept across
 * the view's own URL changes) and names the "Volver" link.
 */
export default function SupervisorCaseRoute() {
  const { caseId = '' } = useParams()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useMemo(() => parseCaseViewSearch(searchParams), [searchParams])
  const routerState: unknown = location.state

  const onStateChange = useCallback(
    (patch: Partial<CaseViewUrlState>, options?: UrlStateChangeOptions) => {
      setSearchParams(
        (current) => toCaseViewSearch({ ...parseCaseViewSearch(current), ...patch }),
        // Keep `state.from`: "Volver" must still know where to go after opening the history.
        { replace: options?.replace ?? false, state: routerState },
      )
    },
    [setSearchParams, routerState],
  )

  const from = readRedirectFrom(routerState)
  const fromAudit = from !== null && from.startsWith(AUDIT_PATH)
  return (
    <SupervisorCaseScreen
      key={caseId}
      caseId={caseId}
      state={state}
      onStateChange={onStateChange}
      backTo={from ?? ROLES.supervisor.home}
      backLabel={fromAudit ? 'Volver a Auditoría' : 'Volver a Equipo y colas'}
    />
  )
}
