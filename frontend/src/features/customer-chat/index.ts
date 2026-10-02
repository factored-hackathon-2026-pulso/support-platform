/**
 * Public API of the customer simulator (/cliente): a dev/demo tool with its own
 * customer session, API client and socket (docs/platform/api/slice-1-cases.md §7.2).
 * Imports no feature except label helpers from `@/features/cases`.
 */
export { CustomerSimulatorScreen } from './components/CustomerSimulatorScreen'
export type { CustomerSimulatorScreenProps } from './components/CustomerSimulatorScreen'
export { customerChatKeys } from './api'
export { registerCustomerChatRealtime } from './realtime'
export type { CustomerConversation, CustomerTurn, DemoCustomer } from './types'
