/**
 * The priority levels a glyph can show (Linear-style, `PriorityIcon`). The words and the
 * menu order live in the feature model (`CASE_PRIORITY` in the cases feature); the
 * primitive only draws.
 */
export type PriorityLevel = 'none' | 'low' | 'medium' | 'high' | 'critical'

export const PRIORITY_LEVELS: readonly PriorityLevel[] = [
  'none',
  'low',
  'medium',
  'high',
  'critical',
]
