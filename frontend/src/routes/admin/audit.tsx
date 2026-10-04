import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useSession } from '@/app/session'
import {
  AuditScreen,
  parseAuditSearch,
  toAuditSearch,
  type AuditStateChangeOptions,
  type AuditUrlState,
} from '@/features/audit'

/**
 * /admin/audit — the same Auditoría screen in the admin section
 * (slice-4-administration.md §7.2, §10.6). An admin without Supervisión cannot
 * open the supervisor case view, so "Ver la conversación" is hidden for her. Supervision
 * notifications toast only on supervision screens (slice 10).
 */
export default function AdminAuditRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasRole } = useSession()
  const state = useMemo(() => parseAuditSearch(searchParams), [searchParams])

  const onStateChange = useCallback(
    (patch: Partial<AuditUrlState>, options?: AuditStateChangeOptions) => {
      setSearchParams((current) => toAuditSearch({ ...parseAuditSearch(current), ...patch }), {
        replace: options?.replace ?? false,
      })
    },
    [setSearchParams],
  )

  return (
    <AuditScreen state={state} onStateChange={onStateChange} canOpenCases={hasRole('supervisor')} />
  )
}
