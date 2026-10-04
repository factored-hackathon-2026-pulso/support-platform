import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import {
  AuditScreen,
  parseAuditSearch,
  toAuditSearch,
  type AuditStateChangeOptions,
  type AuditUrlState,
} from '@/features/audit'
import { useSupervisionNotices } from '@/features/supervision'

/**
 * /supervision/auditoria — Auditoría. Filters, search and the selected event
 * live in the URL (slice-3-supervision.md §8.9). Like every supervision screen
 * it shows the supervision notices (the route composes both features).
 */
export default function AuditRoute() {
  useSupervisionNotices()
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useMemo(() => parseAuditSearch(searchParams), [searchParams])

  const onStateChange = useCallback(
    (patch: Partial<AuditUrlState>, options?: AuditStateChangeOptions) => {
      setSearchParams((current) => toAuditSearch({ ...parseAuditSearch(current), ...patch }), {
        replace: options?.replace ?? false,
      })
    },
    [setSearchParams],
  )

  return <AuditScreen state={state} onStateChange={onStateChange} />
}
