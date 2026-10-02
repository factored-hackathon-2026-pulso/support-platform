/**
 * Semantic tones shared by Badge, StatusDot, FilterTile, ListItemButton…
 * Class strings are written out in full so Tailwind can detect them.
 */
export type Tone = 'neutral' | 'accent' | 'warn' | 'success' | 'danger' | 'callout' | 'waiting'

/** Solid fill (dots, solid badges). */
export const toneFill: Record<Tone, string> = {
  neutral: 'bg-offline',
  accent: 'bg-accent',
  warn: 'bg-warn',
  success: 'bg-success',
  danger: 'bg-danger',
  callout: 'bg-callout',
  waiting: 'bg-waiting',
}

/** Soft pill: tinted background + strong text. */
export const toneSoft: Record<Tone, string> = {
  neutral: 'bg-panel text-ink-2',
  accent: 'bg-accent-soft text-accent-strong',
  warn: 'bg-warn-soft text-warn-strong',
  success: 'bg-success-soft text-success-strong',
  danger: 'bg-danger-soft text-danger-strong',
  callout: 'bg-callout-soft text-callout-strong',
  waiting: 'bg-panel text-ink-2',
}

/** Solid pill: tone background + white text. */
export const toneSolid: Record<Tone, string> = {
  neutral: 'bg-ink text-white',
  accent: 'bg-accent text-white',
  warn: 'bg-warn text-white',
  success: 'bg-success text-white',
  danger: 'bg-danger text-white',
  callout: 'bg-callout text-white',
  // #8a867c is only 3.6:1 with white text: solid "waiting" pills use muted (5.6:1).
  waiting: 'bg-muted text-white',
}

/** Foreground only (numbers, short status text). */
export const toneText: Record<Tone, string> = {
  neutral: 'text-ink',
  accent: 'text-accent',
  warn: 'text-warn',
  success: 'text-success',
  danger: 'text-danger',
  callout: 'text-callout',
  // Text needs 4.5:1; #8a867c stays for dots and borders only.
  waiting: 'text-muted',
}

/** Left status border (3–4px) used by list rows and filter tiles. */
export const toneBorderLeft: Record<Tone, string> = {
  neutral: 'border-l-ink',
  accent: 'border-l-accent',
  warn: 'border-l-warn',
  success: 'border-l-success',
  danger: 'border-l-danger',
  callout: 'border-l-callout',
  waiting: 'border-l-waiting',
}
