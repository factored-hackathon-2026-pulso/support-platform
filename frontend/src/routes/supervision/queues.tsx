import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { supervisionCasePath } from '@/app/paths'
import {
  QueuesScreen,
  parseQueuesSearch,
  toQueuesSearch,
  type QueuesUrlState,
  type UrlStateChangeOptions,
} from '@/features/supervision'

/**
 * /supervision/queues — "Colas" (slice 9), the landing of the Supervisión role. The queue
 * and its filters live in the URL (`?language=&status=&priority=&analyst=`); opening a
 * case hands the full return URL to the case view.
 */
export default function QueuesRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const state = useMemo(() => parseQueuesSearch(searchParams), [searchParams])

  const onStateChange = useCallback(
    (patch: Partial<QueuesUrlState>, options?: UrlStateChangeOptions) => {
      setSearchParams((current) => toQueuesSearch({ ...parseQueuesSearch(current), ...patch }), {
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

  return <QueuesScreen state={state} onStateChange={onStateChange} onOpenCase={onOpenCase} />
}
