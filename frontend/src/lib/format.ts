/**
 * Shared formatting helpers: the one layer for numbers, money, dates, times and relative
 * times (slice 23). Output follows the active UI locale (`lib/i18n/locale`, set by i18next on
 * every language change); pass `{ locale }` to force one (the customer simulator speaks the
 * customer's language). Spanish (neutral LATAM) matches the canvas:
 * "$1.585.208 COP", "4.412", "28%", "hace 2 min", "5 mar 2025", "3 h 40 min";
 * Brazilian Portuguese: "$1.585.208 COP", "4.412", "28%", "há 2 min", "5 mar 2025".
 *
 * Numbers go through `Intl.NumberFormat` with the locale; dates and times through
 * `Intl.DateTimeFormat` (the viewer's zone) and short per-locale word tables, because the
 * canvas' compact forms ("5 mar 2025", "hace 2 min") are not what `Intl` prints for `es`
 * ("5 mar. 2025", "sept").
 */
import { getActiveLocale, type AppLocale } from './i18n/locale'

export type Currency = 'COP' | 'MXN' | 'ARS' | 'USD'

/** Force a locale; default: the active UI locale. */
export interface LocaleOptions {
  locale?: AppLocale
}

/** The `Intl` locale of each UI locale (Spanish keeps the Colombian number format). */
const INTL_LOCALE: Record<AppLocale, string> = { es: 'es-CO', 'pt-BR': 'pt-BR' }

interface LocaleWords {
  monthsShort: readonly string[]
  monthsLong: readonly string[]
  /** Sunday first. */
  weekdays: readonly string[]
  /** "Sábado 3 de octubre" / "Sábado, 3 de outubro". */
  longDate: (weekday: string, day: number, month: string) => string
  now: string
  past: (text: string) => string
  future: (text: string) => string
  days: (count: number) => string
  list: (items: readonly string[]) => string
}

/** A list in Spanish: "A", "A y B", "A, B y C" (backend `copy.join_es`). */
function joinWith(items: readonly string[], conjunction: string): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`
}

const WORDS: Record<AppLocale, LocaleWords> = {
  es: {
    monthsShort: [
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
    ],
    monthsLong: [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ],
    weekdays: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
    longDate: (weekday, day, month) => `${weekday} ${day} de ${month}`,
    now: 'ahora',
    past: (text) => `hace ${text}`,
    future: (text) => `en ${text}`,
    days: (count) => (count === 1 ? '1 día' : `${count} días`),
    list: (items) => joinWith(items, 'y'),
  },
  'pt-BR': {
    monthsShort: [
      'jan',
      'fev',
      'mar',
      'abr',
      'mai',
      'jun',
      'jul',
      'ago',
      'set',
      'out',
      'nov',
      'dez',
    ],
    monthsLong: [
      'janeiro',
      'fevereiro',
      'março',
      'abril',
      'maio',
      'junho',
      'julho',
      'agosto',
      'setembro',
      'outubro',
      'novembro',
      'dezembro',
    ],
    weekdays: [
      'Domingo',
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
    ],
    longDate: (weekday, day, month) => `${weekday}, ${day} de ${month}`,
    now: 'agora',
    past: (text) => `há ${text}`,
    future: (text) => `em ${text}`,
    days: (count) => (count === 1 ? '1 dia' : `${count} dias`),
    list: (items) => joinWith(items, 'e'),
  },
}

function wordsFor(locale: AppLocale | undefined): LocaleWords {
  return WORDS[locale ?? getActiveLocale()]
}

function intlLocale(locale: AppLocale | undefined): string {
  return INTL_LOCALE[locale ?? getActiveLocale()]
}

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
  options: { maximumFractionDigits?: number } & LocaleOptions = {},
): string {
  return new Intl.NumberFormat(intlLocale(options.locale), {
    useGrouping: 'always',
    minimumFractionDigits: 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(value)
}

export interface FormatMoneyOptions extends LocaleOptions {
  /** Append the ISO code ("$1.585.208 COP"). Default true. */
  withCode?: boolean
  /** Force a number of decimals. Default: 0 for COP, exactly 2 for the rest. */
  fractionDigits?: number
}

/** "$1.585.208 COP", "$12.400,50 MXN", "-$305.909 COP". */
export function formatMoney(
  amount: number,
  currency: Currency = 'COP',
  { withCode = true, fractionDigits, locale }: FormatMoneyOptions = {},
): string {
  const whole = WHOLE_UNIT_CURRENCIES.has(currency)
  const digits = fractionDigits ?? (whole ? 0 : 2)
  const number = new Intl.NumberFormat(intlLocale(locale), {
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
    locale,
  }: { fromRatio?: boolean; maximumFractionDigits?: number } & LocaleOptions = {},
): string {
  const pct = fromRatio ? value * 100 : value
  return `${formatNumber(pct, { maximumFractionDigits, locale })}%`
}

export interface FormatDateOptions extends TimeZoneOptions, LocaleOptions {
  /** Default true. `false` → "5 mar". */
  withYear?: boolean
}

/** "5 mar 2025" (in the viewer's zone). `withYear: false` → "5 mar". */
export function formatDate(
  value: DateInput,
  { withYear = true, timeZone, locale }: FormatDateOptions = {},
): string {
  const { day, month, year } = zonedParts(toDate(value), timeZone)
  const base = `${day} ${wordsFor(locale).monthsShort[month - 1]}`
  return withYear ? `${base} ${year}` : base
}

export interface FormatTimeOptions extends TimeZoneOptions, LocaleOptions {
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

/**
 * "Sábado 3 de octubre" / "Sábado, 3 de outubro" (in the viewer's zone): page headers that
 * name the day.
 */
export function formatLongDate(
  value: DateInput,
  { timeZone, locale }: TimeZoneOptions & LocaleOptions = {},
): string {
  const { year, month, day } = zonedParts(toDate(value), timeZone)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const words = wordsFor(locale)
  return words.longDate(words.weekdays[weekday] ?? '', day, words.monthsLong[month - 1] ?? '')
}

/** Hour of the day 0–23 of an instant in the viewer's zone (greetings). */
export function localHour(value: DateInput, { timeZone }: TimeZoneOptions = {}): number {
  return zonedParts(toDate(value), timeZone).hour
}

/** "5 mar 2025, 11:02". */
export function formatDateTime(value: DateInput, options: FormatDateOptions = {}): string {
  return `${formatDate(value, options)}, ${formatTime(value, options)}`
}

/**
 * Compact relative time used across the canvas.
 * Past: "ahora", "hace 2 min", "hace 3 h", "hace 2 días", then the date ("5 mar 2025").
 * Future: "en 9 min", "en 2 h", "en 3 días". Portuguese: "agora", "há 2 min", "em 9 min",
 * "há 2 dias".
 * `now` is explicit so callers decide the clock (`Date.now()` or a time the
 * server sent, e.g. for SLA countdowns) and tests stay deterministic.
 */
export function formatRelativeTime(
  value: DateInput,
  now: DateInput,
  { locale }: LocaleOptions = {},
): string {
  const words = wordsFor(locale)
  const diffMs = toDate(value).getTime() - toDate(now).getTime()
  const future = diffMs > 0
  const minutes = Math.round(Math.abs(diffMs) / 60_000)
  const wrap = future ? words.future : words.past

  if (minutes < 1) return words.now
  if (minutes < 60) return wrap(`${minutes} min`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return wrap(`${hours} h`)
  const days = Math.floor(hours / 24)
  if (days < 30) return wrap(words.days(days))
  return formatDate(value, { locale })
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

/** A list in the active locale: "A, B y C" / "A, B e C". Empty → "". */
export function formatList(items: readonly string[], { locale }: LocaleOptions = {}): string {
  return wordsFor(locale).list(items)
}
