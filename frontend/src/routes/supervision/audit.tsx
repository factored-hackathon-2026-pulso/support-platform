import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import {
  AuditScreen,
  parseAuditSearch,
  toAuditSearch,
  type AuditStateChangeOptions,
  type AuditUrlState,
} from '@/features/audit'

/**
 * /supervision/audit — Auditoría. Filters, search and the selected event
 * live in the URL (slice-3-supervision.md §8.9). The supervision notices come from the
 * notification center in the shell (slice 10), like on every screen.
 */
export default function AuditRoute() {
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
