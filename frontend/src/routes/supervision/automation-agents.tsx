import { AgentsScreen, AutomationGate } from '@/features/automation'

/** /supervision/automation/agents — the agents (slice 22). */
export default function AutomationAgentsRoute() {
  return (
    <AutomationGate>
      <AgentsScreen />
    </AutomationGate>
  )
}
