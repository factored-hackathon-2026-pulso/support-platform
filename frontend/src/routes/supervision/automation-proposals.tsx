import { AutomationGate, ProposalsScreen } from '@/features/automation'

/** /supervision/automation/proposals — the proposals to change agents (slice 22). */
export default function AutomationProposalsRoute() {
  return (
    <AutomationGate>
      <ProposalsScreen />
    </AutomationGate>
  )
}
