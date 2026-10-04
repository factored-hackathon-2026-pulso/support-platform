/**
 * Core public API of the home feature: what the always-loaded app shell may
 * import without pulling in the screen (ARCHITECTURE.md §3, "Two public
 * files"): the query keys and the realtime registration. No components.
 */
export { homeKeys } from './api'
export { HOME_REFETCH_THROTTLE_MS, HOME_SIGNALS, registerHomeRealtime } from './realtime'
export type {
  AnalystHome,
  HomeActivityItem,
  HomeActivityKind,
  HomeQueue,
  HomeTeam,
  SinceSource,
} from './types'
