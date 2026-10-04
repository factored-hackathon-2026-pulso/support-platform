import { Globe } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  LANGUAGE_MARK_CODE,
  LANGUAGE_NATIVE_NAME,
  languagesName,
  sortLanguages,
  type LanguageCode,
} from './language'
import { Tooltip } from './Tooltip'

/** `sm` for dense rows and headers (14 px globe, 12 px codes); `lg` for a card or a title. */
export type LanguageMarkSize = 'sm' | 'lg'

const GLOBE_SIZE: Record<LanguageMarkSize, number> = { sm: 14, lg: 16 }
const CODE_TEXT: Record<LanguageMarkSize, string> = { sm: 'text-12', lg: 'text-16' }

/** The language glyph: a muted, stroked globe. Decorative: codes or a name follow it. */
function LanguageGlobe({ size }: { size: number }) {
  return <Globe size={size} aria-hidden="true" className="shrink-0 text-muted" />
}

export interface LanguageMarkProps {
  /** Unknown values are dropped; the codes follow the canonical order. */
  languages: readonly string[]
  size?: LanguageMarkSize
  className?: string
}

/**
 * One globe, then the codes ("ES", "ES PT"). Decorative (`aria-hidden`): the caller
 * names it (`LanguageMarks`, or a control's accessible name such as a filter chip).
 */
export function LanguageMark({ languages, size = 'sm', className }: LanguageMarkProps) {
  const sorted = sortLanguages(languages)
  if (sorted.length === 0) return null
  return (
    <span
      aria-hidden="true"
      data-languages={sorted.join(' ')}
      className={cn(
        'inline-flex items-center gap-1.5 font-semibold tracking-[0.04em] whitespace-nowrap',
        CODE_TEXT[size],
        className,
      )}
    >
      <LanguageGlobe size={GLOBE_SIZE[size]} />
      {sorted.map((language) => (
        <span key={language}>{LANGUAGE_MARK_CODE[language]}</span>
      ))}
    </span>
  )
}

export interface LanguageMarksProps {
  /** Unknown values are dropped; the codes follow the canonical order. */
  languages: readonly string[]
  /**
   * The group's tooltip takes the keyboard focus (default). Pass `false` inside a
   * button or a link: the name is then part of that control's accessible name.
   */
  focusable?: boolean
  /**
   * The tooltip and screen-reader name when the mark stands for more than the
   * languages ("Cola en español"); default "Español y Português".
   */
  name?: string
  size?: LanguageMarkSize
  /** Text color of the codes (default `text-ink-2`). */
  className?: string
}

/**
 * The languages of a person or a case as one mark, for dense rows and headers: the
 * mark is visual, the group's name ("Español y Português") is its tooltip and its
 * screen-reader text. Nothing for no language (the caller shows its own empty value).
 */
export function LanguageMarks({
  languages,
  focusable = true,
  name: givenName,
  size = 'sm',
  className,
}: LanguageMarksProps) {
  const sorted = sortLanguages(languages)
  if (sorted.length === 0) return null
  const name = givenName ?? languagesName(sorted)
  const only = !givenName && sorted.length === 1 ? sorted[0] : undefined
  return (
    <Tooltip
      content={name}
      focusable={focusable}
      className={cn('items-center align-middle text-ink-2', className)}
    >
      <span className="sr-only" lang={only}>
        {name}
      </span>
      <LanguageMark languages={sorted} size={size} />
    </Tooltip>
  )
}

export interface LanguageNameProps {
  language: LanguageCode
  className?: string
}

/**
 * Globe + the language's own name, where the name is the value ("Idioma" rows):
 * "[globe] Português", no code. The globe is decorative, the name is read.
 */
export function LanguageName({ language, className }: LanguageNameProps) {
  return (
    <span
      data-language={language}
      className={cn('inline-flex min-w-0 items-center gap-1.5', className)}
    >
      <LanguageGlobe size={GLOBE_SIZE.sm} />
      <span lang={language}>{LANGUAGE_NATIVE_NAME[language]}</span>
    </span>
  )
}
