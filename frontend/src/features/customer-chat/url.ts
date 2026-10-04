/**
 * URL state of the customer simulator (`/customer?channel=chat|call|email`; none = the
 * channel picker). Pure: unit-tested in url.test.ts.
 */
import { SIM_CHANNELS, type SimChannel } from './channels'

/** `?channel=` → the channel picked; unknown or absent → null (the picker). */
export function parseSimulatorChannel(params: URLSearchParams): SimChannel | null {
  const value = params.get('channel')
  return SIM_CHANNELS.find((channel) => channel === value) ?? null
}

export function toSimulatorSearch(channel: SimChannel | null): URLSearchParams {
  return new URLSearchParams(channel ? { channel } : {})
}
