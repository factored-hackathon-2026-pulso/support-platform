/**
 * Shared formatting helpers. Spanish (neutral LATAM) output, matching the canvas:
 * "$1.585.208 COP", "4.412", "28%", "hace 2 min", "5 mar 2025", "3 h 40 min".
 */

export type Currency = 'COP' | 'MXN' | 'ARS' | 'USD'

const LOCALE = 'es-CO'

/**
 * Dates and times are shown in the viewer's own time zone (the browser's), so an
 * analyst in Ciudad de México, Bogotá or Buenos Aires reads "10:47" on their own
 * clock. The API sends ISO-8601 UTC instants. Pass `timeZone` (IANA name) only
 * when a screen must show another zone on purpose, and then say so in the copy
 * (e.g. "10:47 (hora Bogotá)"). Tests pin the process zone in vite.config.ts.
 */
export interface TimeZoneOptions {
  /** IANA zone ("America/Bogota"). Default: the viewer's zone. */
  timeZone?: string
}

const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const

/** Currencies shown without cents by default. */
const WHOLE_UNIT_CURRENCIES: ReadonlySet<Currency> = new Set(['COP'])

type DateInput = Date | string | number

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** One parts formatter per zone ('' = the viewer's), built on first use. */
const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? ''
  let formatter = partsFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      ...(timeZone ? { timeZone } : {}),
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
    partsFormatters.set(key, formatter)
  }
  return formatter
}

interface DateParts {
  year: number
  /** 1–12 */
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Calendar parts of `d` in `timeZone` (default: the viewer's zone). */
function zonedParts(d: Date, timeZone?: string): DateParts {
  const parts: Record<string, number> = {}
  for (const part of partsFormatter(timeZone).formatToParts(d)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  }
}

/** "4.412", "1.585.208", "1,2" (always groups thousands, even 4-digit numbers). */
export function formatNumber(
  value: number,
  options: { maximumFractionDigits?: number } = {},
): string {
  return new Intl.NumberFormat(LOCALE, {
    useGrouping: 'always',
    minimumFractionDigits: 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(value)
}

export interface FormatMoneyOptions {
  /** Append the ISO code ("$1.585.208 COP"). Default true. */
  withCode?: boolean
  /** Force a number of decimals. Default: 0 for COP, exactly 2 for the rest. */
  fractionDigits?: number
}

/** "$1.585.208 COP", "$12.400,50 MXN", "-$305.909 COP". */
export function formatMoney(
  amount: number,
  currency: Currency = 'COP',
  { withCode = true, fractionDigits }: FormatMoneyOptions = {},
): string {
  const whole = WHOLE_UNIT_CURRENCIES.has(currency)
  const digits = fractionDigits ?? (whole ? 0 : 2)
  const number = new Intl.NumberFormat(LOCALE, {
    useGrouping: 'always',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(amount))
  const sign = amount < 0 ? '-' : ''
  return `${sign}$${number}${withCode ? ` ${currency}` : ''}`
}

/** 0.28 → "28%". Pass `fromRatio: false` when the value is already a percentage. */
export function formatPercent(
  value: number,
  {
    fromRatio = true,
    maximumFractionDigits = 0,
  }: { fromRatio?: boolean; maximumFractionDigits?: number } = {},
): string {
  const pct = fromRatio ? value * 100 : value
  return `${formatNumber(pct, { maximumFractionDigits })}%`
}

export interface FormatDateOptions extends TimeZoneOptions {
  /** Default true. `false` → "5 mar". */
  withYear?: boolean
}

/** "5 mar 2025" (in the viewer's zone). `withYear: false` → "5 mar". */
export function formatDate(
  value: DateInput,
  { withYear = true, timeZone }: FormatDateOptions = {},
): string {
  const { day, month, year } = zonedParts(toDate(value), timeZone)
  const base = `${day} ${MONTHS_SHORT[month - 1]}`
  return withYear ? `${base} ${year}` : base
}

export interface FormatTimeOptions extends TimeZoneOptions {
  /** "11:02:05" (audit log). Default false. */
  withSeconds?: boolean
}

/** "11:02" (24 h, in the viewer's zone); `withSeconds` → "11:02:05". */
export function formatTime(
  value: DateInput,
  { timeZone, withSeconds = false }: FormatTimeOptions = {},
): string {
  const { hour, minute, second } = zonedParts(toDate(value), timeZone)
  const base = `${pad2(hour)}:${pad2(minute)}`
  return withSeconds ? `${base}:${pad2(second)}` : base
}

/**
 * Calendar day of an instant in the viewer's zone, as "YYYY-MM-DD" (day
 * separators, date filters). Two instants share a day when their keys match.
 */
export function localDayKey(value: DateInput, { timeZone }: TimeZoneOptions = {}): string {
  const { year, month, day } = zonedParts(toDate(value), timeZone)
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/** "5 mar 2025, 11:02". */
export function formatDateTime(value: DateInput, options: FormatDateOptions = {}): string {
  return `${formatDate(value, options)}, ${formatTime(value, options)}`
}

/**
 * Compact relative time used across the canvas.
 * Past: "ahora", "hace 2 min", "hace 3 h", "hace 2 días", then the date ("5 mar 2025").
 * Future: "en 9 min", "en 2 h", "en 3 días".
 * `now` is explicit so callers decide the clock (`Date.now()` or a time the
 * server sent, e.g. for SLA countdowns) and tests stay deterministic.
 */
export function formatRelativeTime(value: DateInput, now: DateInput): string {
  const diffMs = toDate(value).getTime() - toDate(now).getTime()
  const future = diffMs > 0
  const minutes = Math.round(Math.abs(diffMs) / 60_000)
  const wrap = (text: string) => (future ? `en ${text}` : `hace ${text}`)

  if (minutes < 1) return 'ahora'
  if (minutes < 60) return wrap(`${minutes} min`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return wrap(`${hours} h`)
  const days = Math.floor(hours / 24)
  if (days < 30) return wrap(days === 1 ? '1 día' : `${days} días`)
  return formatDate(value)
}

/** Minutes → "52 min", "1 h 05 min", "11 h". */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes))
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${pad2(m)} min`
}

/** Seconds → "02:41" call timer. */
export function formatTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`
}

/** "8501" → "•••• 8501". */
export function maskLast4(last4: string): string {
  return `•••• ${last4.slice(-4)}`
}

/**
 * Initials as the canvas shows them: first name + first surname.
 * "Diego Romero Contreras" → "DR", "Samuel Óscar Campos Cruz" → "SC", "Ana Díaz" → "AD".
 */
export function getInitials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean)
  const first = words[0]
  if (!first) return ''
  if (words.length === 1) return first.slice(0, 2).toUpperCase()
  const surname = words.length >= 3 ? words[words.length - 2] : words[words.length - 1]
  return `${first[0] ?? ''}${surname?.[0] ?? ''}`.toUpperCase()
}

/** "1 caso" / "3 casos". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

/**
 * A list in Spanish: "A", "A y B", "A, B y C" (same rule as the backend
 * `copy.join_es`, slice-4-administration.md §1.2). Empty → "".
 */
export function joinEs(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}
