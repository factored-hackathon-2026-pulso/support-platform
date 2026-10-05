import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import {
  AutomationGate,
  parseAutomationSearch,
  toAutomationSearch,
  TypesScreen,
  type MaturingType,
} from '@/features/automation'

/**
 * /supervision/automation — "Automatización" (slice 22): the case types and their stage; `?type=`
 * opens one in the side panel. Only with the AI switch on (otherwise back to Colas).
 */
export default function AutomationRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useMemo(() => parseAutomationSearch(searchParams), [searchParams])
  const onSelectType = useCallback(
    (type: MaturingType | null) => setSearchParams(toAutomationSearch({ type })),
    [setSearchParams],
  )
  return (
    <AutomationGate>
      <TypesScreen state={state} onSelectType={onSelectType} />
    </AutomationGate>
  )
}
