import { createElement, type ComponentType } from 'react'
import {
  Calendar,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CirclePause,
  Clock,
  Eye,
  Flag,
  Flame,
  Frown,
  Globe,
  Hash,
  History,
  Hourglass,
  IdCard,
  Inbox,
  Languages,
  Laugh,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Meh,
  MessageSquare,
  Smartphone,
  Smile,
  User,
  Users,
  type LucideProps,
} from 'lucide-react'
import { PriorityIcon } from './PriorityIcon'
import type { PriorityLevel } from './priority-levels'

/** A priority glyph (`PriorityIcon`) usable wherever a fact names its icon. */
function priorityGlyph(level: PriorityLevel) {
  function PriorityGlyph({ size, className }: LucideProps) {
    return createElement(PriorityIcon, {
      level,
      size: typeof size === 'number' ? size : 14,
      className,
    })
  }
  PriorityGlyph.displayName = `PriorityGlyph(${level})`
  return PriorityGlyph
}

/** The overdue SLA: the same flame, filled. */
function FlameFilled(props: LucideProps) {
  return createElement(Flame, { ...props, fill: 'currentColor' })
}

/**
 * The icon vocabulary of short facts (slice 6 UI rule: one fact = icon + 1–3
 * words). Features name icons from their pure `model.ts` (no React there); the
 * `Fact` primitive draws them.
 */
export const FACT_ICONS = {
  alert: CircleAlert,
  calendar: Calendar,
  'calendar-clock': CalendarClock,
  check: CircleCheck,
  clock: Clock,
  eye: Eye,
  flag: Flag,
  flame: Flame,
  'flame-filled': FlameFilled,
  frown: Frown,
  globe: Globe,
  hash: Hash,
  history: History,
  hourglass: Hourglass,
  id: IdCard,
  inbox: Inbox,
  languages: Languages,
  laugh: Laugh,
  lock: Lock,
  'log-out': LogOut,
  mail: Mail,
  'map-pin': MapPin,
  meh: Meh,
  message: MessageSquare,
  pause: CirclePause,
  'priority-none': priorityGlyph('none'),
  'priority-low': priorityGlyph('low'),
  'priority-medium': priorityGlyph('medium'),
  'priority-high': priorityGlyph('high'),
  'priority-critical': priorityGlyph('critical'),
  smartphone: Smartphone,
  smile: Smile,
  user: User,
  users: Users,
} as const satisfies Record<string, ComponentType<LucideProps>>

export type FactIcon = keyof typeof FACT_ICONS

/** Text tone of a fact (status colors; text keeps 4.5:1). */
export type FactTone = 'default' | 'muted' | 'danger' | 'warn' | 'success' | 'accent'

/** One short fact, as a feature's model describes it. */
export interface FactItem {
  key: string
  icon: FactIcon
  /** 1–3 words: "App", "hace 2 min", "Esperó 14 min". */
  text: string
  tone?: FactTone
  /** Read before the text by screen readers only ("Canal", "Última actividad"). */
  label?: string
  /** A small tag after the text ("Regla 3"). */
  tag?: string
  /**
   * Secondary, easy-to-learn facts (channel, a non-Spanish language, a high or
   * critical priority, "Volvió a escribir", a rating face): only the icon shows, the text is the
   * tooltip and the accessible text. Never for status, reasons, names or the SLA.
   */
  iconOnly?: boolean
  /** A tooltip with more context than the visible text (e.g. "Última actividad" on a time). */
  tooltip?: string
}
