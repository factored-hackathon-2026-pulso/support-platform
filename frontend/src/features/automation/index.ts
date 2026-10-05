/**
 * Public API of "Automatización" (slice 22, docs/platform/api/slice-22-automation.md): the case
 * types' maturity for Supervisión, the agent the system proposes for a mature type (proposal,
 * test, approval, publication and activation on agent-core's registry), the agents and the chat
 * with the builder agent. Only while the AI functions are on.
 */
export { AutomationGate } from './components/AutomationFrame'
export { TypesScreen } from './components/TypesScreen'
export type { TypesScreenProps } from './components/TypesScreen'
export { ProposalsScreen } from './components/ProposalsScreen'
export { ProposalScreen } from './components/ProposalScreen'
export type { ProposalScreenProps } from './components/ProposalScreen'
export { AgentsScreen } from './components/AgentsScreen'
export { AgentScreen } from './components/AgentScreen'
export { parseAutomationSearch, toAutomationSearch } from './url'
export type { AutomationUrlState } from './url'
export type * from './types'
