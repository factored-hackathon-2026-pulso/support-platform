import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import {
  WorkspaceScreen,
  parseWorkspaceSearch,
  toWorkspaceSearch,
  type WorkspaceStateChangeOptions,
  type WorkspaceUrlState,
} from '@/features/workspace'

/**
 * /analista — Workspace. Shareable state lives in the URL:
 * `?caso=&estado=&q=&lista=&historial=` (slice-2-case-lifecycle.md §9.2).
 */
export default function WorkspaceRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useMemo(() => parseWorkspaceSearch(searchParams), [searchParams])

  const onStateChange = useCallback(
    (patch: Partial<WorkspaceUrlState>, options?: WorkspaceStateChangeOptions) => {
      setSearchParams(
        (current) => toWorkspaceSearch({ ...parseWorkspaceSearch(current), ...patch }),
        { replace: options?.replace ?? false },
      )
    },
    [setSearchParams],
  )

  return <WorkspaceScreen state={state} onStateChange={onStateChange} />
}
