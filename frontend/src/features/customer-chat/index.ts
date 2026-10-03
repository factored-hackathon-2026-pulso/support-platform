/**
 * Public API of the customer simulator (/cliente): a dev/demo tool with its own
 * customer session, API client and socket
 * (docs/platform/api/slice-2-case-lifecycle.md §9.6). Imports no other feature.
 */
export { CustomerSimulatorScreen } from './components/CustomerSimulatorScreen'
export type { CustomerSimulatorScreenProps } from './components/CustomerSimulatorScreen'
export { customerChatKeys } from './api'
export { registerCustomerChatRealtime } from './realtime'
export type {
  CustomerConversation,
  CustomerConversationSummary,
  CustomerTurn,
  DemoCustomer,
} from './types'
