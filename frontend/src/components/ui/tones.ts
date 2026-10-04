/**
 * Semantic tones shared by Badge, Status / StatusIcon, FilterTile, ListItemButton…
 * Class strings are written out in full so Tailwind can detect them.
 *
 * Case statuses (brief §5.4): accent = Nuevos, warn = Por responder, waiting =
 * Esperando al cliente, closed = Cerrados. `closed` is a neutral grey built on
 * the existing `offline` / `muted` tokens (no color of its own).
 */
export type Tone = 'neutral' | 'accent' | 'warn' | 'success' | 'danger' | 'waiting' | 'closed'

/** Soft pill: tinted background + strong text. */
export const toneSoft: Record<Tone, string> = {
  neutral: 'bg-panel text-ink-2',
  accent: 'bg-accent-soft text-accent-strong',
  warn: 'bg-warn-soft text-warn-strong',
  success: 'bg-success-soft text-success-strong',
  danger: 'bg-danger-soft text-danger-strong',
  waiting: 'bg-panel text-ink-2',
  closed: 'bg-panel text-muted',
}

/** Solid pill: tone background + white text. */
export const toneSolid: Record<Tone, string> = {
  neutral: 'bg-ink text-white',
  accent: 'bg-accent text-white',
  warn: 'bg-warn text-white',
  success: 'bg-success text-white',
  danger: 'bg-danger text-white',
  // #8a867c is only 3.6:1 with white text: solid "waiting" pills use muted (5.6:1).
  waiting: 'bg-muted text-white',
  closed: 'bg-muted text-white',
}

/** Foreground only (numbers, short status text). */
export const toneText: Record<Tone, string> = {
  neutral: 'text-ink',
  accent: 'text-accent',
  warn: 'text-warn',
  success: 'text-success',
  danger: 'text-danger',
  // Text needs 4.5:1; #8a867c stays for dots and borders only.
  waiting: 'text-muted',
  closed: 'text-muted',
}

/** Left status border (3–4px) used by list rows and filter tiles. */
export const toneBorderLeft: Record<Tone, string> = {
  neutral: 'border-l-ink',
  accent: 'border-l-accent',
  warn: 'border-l-warn',
  success: 'border-l-success',
  danger: 'border-l-danger',
  waiting: 'border-l-waiting',
  closed: 'border-l-offline',
}

/**
 * Status glyph color (StatusIcon: rings, pies, dots). A graphic beside its text
 * label, so `waiting` keeps its own grey here; `neutral` and `closed` use muted.
 */
export const toneIcon: Record<Tone, string> = {
  neutral: 'text-muted',
  accent: 'text-accent',
  warn: 'text-warn',
  success: 'text-success',
  danger: 'text-danger',
  waiting: 'text-waiting',
  closed: 'text-muted',
}

/** Emphasized status label (Status `strong`): the tone's strong text (4.5:1 and up). */
export const toneStrongText: Record<Tone, string> = {
  neutral: 'text-ink',
  accent: 'text-accent-strong',
  warn: 'text-warn-strong',
  success: 'text-success-strong',
  danger: 'text-danger-strong',
  waiting: 'text-ink-2',
  closed: 'text-muted',
}
