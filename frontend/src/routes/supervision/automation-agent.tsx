import { useParams } from 'react-router'
import { AgentScreen, AutomationGate } from '@/features/automation'

/** /supervision/automation/agents/:agentId — one agent (slice 22). */
export default function AutomationAgentRoute() {
  const { agentId = '' } = useParams()
  return (
    <AutomationGate>
      <AgentScreen key={agentId} agentId={agentId} />
    </AutomationGate>
  )
}
