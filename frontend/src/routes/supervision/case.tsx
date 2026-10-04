import { useCallback, useMemo } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router'
import { ROLES } from '@/app/roles'
import { readRedirectFrom } from '@/app/redirect'
import {
  SupervisorCaseScreen,
  backLabelFor,
  parseCaseViewSearch,
  toCaseViewSearch,
  type CaseViewUrlState,
  type UrlStateChangeOptions,
} from '@/features/supervision'

/**
 * /supervision/cases/:caseId — the supervisor's read-only case view
 * (slice-3-supervision.md §8.5). `?previous=&reassign=` live in the URL; the
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
  return (
    <SupervisorCaseScreen
      key={caseId}
      caseId={caseId}
      state={state}
      onStateChange={onStateChange}
      backTo={from ?? ROLES.supervisor.home}
      backLabel={backLabelFor(from)}
    />
  )
}
