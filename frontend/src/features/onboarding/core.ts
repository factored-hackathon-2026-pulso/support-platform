/**
 * Screen-free public API of the onboarding feature (ARCHITECTURE.md §3): what a route
 * outside the feature's screens may import without pulling them in (the login route
 * asks whether the dev mailbox is on, to show its link).
 */
export { onboardingKeys } from './api'
export { useDevMailboxEnabled } from './hooks/use-onboarding'
