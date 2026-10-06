import type { AgentAvatarKey } from '../types'

/** The ten avatars, as fingerprinted URLs (never inlined in the entry chunk). */
const urls = import.meta.glob<string>('../../../assets/agent-avatars/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})

export const AGENT_AVATARS: readonly AgentAvatarKey[] = [
  'star',
  'circle',
  'hexagon',
  'drop',
  'triangle',
  'rhombus',
  'cloud',
  'square',
  'flame',
  'ring',
]

export function avatarUrl(avatar: AgentAvatarKey): string | undefined {
  return urls[`../../../assets/agent-avatars/${avatar}.svg`]
}
