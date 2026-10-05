import { useCallback, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router'
import {
  AutomationGate,
  parseAutomationSearch,
  ProposalScreen,
  toAutomationSearch,
  type MaturingType,
} from '@/features/automation'

/**
 * /supervision/automation/proposals/:proposalId?type= — one proposal (slice 22); `type` is the
 * case type it is for (what "Activar" serves).
 */
export default function AutomationProposalRoute() {
  const { proposalId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { type } = useMemo(() => parseAutomationSearch(searchParams), [searchParams])
  const onTypeChange = useCallback(
    (next: MaturingType) => setSearchParams(toAutomationSearch({ type: next }), { replace: true }),
    [setSearchParams],
  )
  return (
    <AutomationGate>
      <ProposalScreen
        key={proposalId}
        proposalId={proposalId}
        type={type}
        onTypeChange={onTypeChange}
      />
    </AutomationGate>
  )
}
