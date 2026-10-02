import type { Tone } from '@/components/ui'

/**
 * Full status ring of the collapsed rail's initials (Workspace.dc.html
 * `listClosed`). Written out in full so Tailwind detects the classes.
 */
export const toneRing: Record<Tone, string> = {
  neutral: 'border-ink',
  accent: 'border-accent',
  warn: 'border-warn',
  success: 'border-success',
  danger: 'border-danger',
  callout: 'border-callout',
  waiting: 'border-waiting',
}
