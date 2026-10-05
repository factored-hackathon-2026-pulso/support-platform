/**
 * The query string of "Automatización" (slice 22): the case type open in the side panel of the
 * panorama, or the type a proposal is for (`?type=`, the API's `CaseType`). Unknown values, "Sin
 * tipo" included, read as none.
 */
import type { MaturingType } from './types'

const MATURING_TYPES: readonly MaturingType[] = [
  'unrecognized_charge',
  'undue_charge',
  'app_issue',
  'branch_service',
  'service_quality',
  'virtual_card',
]

export interface AutomationUrlState {
  type: MaturingType | null
}

export function parseAutomationSearch(params: URLSearchParams): AutomationUrlState {
  const raw = params.get('type')
  const type = MATURING_TYPES.find((value) => value === raw) ?? null
  return { type }
}

export function toAutomationSearch(state: AutomationUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.type) params.set('type', state.type)
  return params
}
