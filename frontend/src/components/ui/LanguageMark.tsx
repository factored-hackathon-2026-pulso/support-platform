import { cn } from '@/lib/cn'
import {
  LANGUAGE_MARK_CODE,
  LANGUAGE_NATIVE_NAME,
  languagesName,
  sortLanguages,
  type LanguageCode,
} from './language'
import { Tooltip } from './Tooltip'

/*
 * Flag artwork from the Figma "Flags icons" community file (nodes ES 3:157, PT 3:67):
 * 21×15 rounded rectangles with a 10 % black hairline. The export's black frame, mask
 * and clip path are dropped, so the shapes carry no ids and can repeat on a page. The
 * flag colors are artwork, not UI tokens.
 */
const CARD =
  'M19 0H2C0.89543 0 0 0.89543 0 2V13C0 14.1046 0.89543 15 2 15H19C20.1046 15 21 14.1046 21 13V2C21 0.89543 20.1046 0 19 0Z'
const OUTLINE =
  'M19 0.5H2C1.17157 0.5 0.5 1.17157 0.5 2V13C0.5 13.8284 1.17157 14.5 2 14.5H19C19.8284 14.5 20.5 13.8284 20.5 13V2C20.5 1.17157 19.8284 0.5 19 0.5Z'

/** Spain's flag: the mark of Spanish. */
function SpainFlagShapes() {
  return (
    <>
      <path d={CARD} fill="#CD0B20" />
      <path d="M0 4H21V11H0V4Z" fill="#FFCB00" />
      <path
        d="M9 6.22201V8.742C9 9.442 8.328 10.002 7.5 10.002H5.5C4.674 10 4 9.43701 4 8.74001V6.22C4 5.648 4.448 5.17001 5.064 5.01501C5.25 4.49501 5.822 4.96101 6.5 4.96101C7.182 4.96101 7.75 4.498 7.936 5.016C8.55 5.175 9 5.65401 9 6.22201Z"
        fill="#C8B47C"
      />
      <path d="M9 7H10V10H9V7ZM3 7H4V10H3V7Z" fill="#B5B5B5" />
      <path d="M9 9H10V10H9V9ZM3 9H4V10H3V9Z" fill="#165C96" />
      <path d="M9 6H10V7H9V6ZM3 6H4V7H3V6Z" fill="#A0790A" />
      <path d="M5 6H6V7.5H5V6ZM7 8H8V9.5H7V8Z" fill="#D20636" />
      <path d="M7 6H8V7.5H7V6Z" fill="#A18793" />
      <path d="M5 8H6V9.5H5V8Z" fill="#FFE100" />
      <path d="M6 6L5 5H8L7 6H6Z" fill="#B6161A" />
      <path d="M6 4H7V5H6V4Z" fill="#AC9300" />
    </>
  )
}

/** Portugal's flag: the mark of Portuguese (also for a pt-BR customer). */
function PortugalFlagShapes() {
  return (
    <>
      <path d={CARD} fill="#FF0000" />
      <path d="M2 0H7V15H2C0.89543 15 0 14.1046 0 13V2C0 0.89543 0.89543 0 2 0Z" fill="#006700" />
      <path
        d="M7 10C8.65685 10 10 8.65685 10 7C10 5.34315 8.65685 4 7 4C5.34315 4 4 5.34315 4 7C4 8.65685 5.34315 10 7 10Z"
        fill="#FFFF00"
      />
      <path d="M9 8V5H5V8C5 8.552 5.895 9 7 9C8.105 9 9 8.552 9 8Z" fill="#FF0000" />
      <path d="M6 6H8V8H6V6Z" fill="#FFFFFF" />
      <path d="M6 6H7V7H6V6ZM7 7H8V8H7V7Z" fill="#002E9C" />
    </>
  )
}

export interface LanguageFlagProps {
  language: LanguageCode
  /** Width in px; the height keeps the 21:15 ratio. 18 in marks, 21 in option rows. */
  width?: number
  className?: string
}

/** The flag of a language. Decorative: the code or the name is always said next to it. */
export function LanguageFlag({ language, width = 18, className }: LanguageFlagProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={width}
      height={Math.round((width * 15) / 21)}
      viewBox="0 0 21 15"
      data-language={language}
      className={cn('block shrink-0', className)}
    >
      {language === 'pt' ? <PortugalFlagShapes /> : <SpainFlagShapes />}
      <path d={OUTLINE} fill="none" stroke="#000000" strokeOpacity={0.1} />
    </svg>
  )
}

export interface LanguageMarkProps {
  language: LanguageCode
  className?: string
}

/** Flag + code ("ES", "PT"). Decorative on its own: `LanguageMarks` names the group. */
export function LanguageMark({ language, className }: LanguageMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center gap-1 text-12 font-semibold tracking-[0.04em] whitespace-nowrap',
        className,
      )}
    >
      <LanguageFlag language={language} />
      {LANGUAGE_MARK_CODE[language]}
    </span>
  )
}

export interface LanguageMarksProps {
  /** Unknown values are dropped; the marks follow the canonical order. */
  languages: readonly string[]
  /**
   * The group's tooltip takes the keyboard focus (default). Pass `false` inside a
   * button or a link: the name is then part of that control's accessible name.
   */
  focusable?: boolean
  /** Text color of the codes (default `text-ink-2`). */
  className?: string
}

/**
 * The languages of a person or a case as marks, for dense rows and headers: the
 * marks are visual, the group's name ("Español y Português") is its tooltip and its
 * screen-reader text. Nothing for no language (the caller shows its own empty value).
 */
export function LanguageMarks({ languages, focusable = true, className }: LanguageMarksProps) {
  const sorted = sortLanguages(languages)
  if (sorted.length === 0) return null
  const name = languagesName(sorted)
  const only = sorted.length === 1 ? sorted[0] : undefined
  return (
    <Tooltip
      content={name}
      focusable={focusable}
      className={cn('items-center gap-1.5 text-ink-2', className)}
    >
      <span className="sr-only" lang={only}>
        {name}
      </span>
      {sorted.map((language) => (
        <LanguageMark key={language} language={language} />
      ))}
    </Tooltip>
  )
}

export interface LanguageNameProps {
  language: LanguageCode
  className?: string
}

/**
 * Mark + the language's own name, where the name is the value ("Idioma" rows):
 * "[flag] PT Português". The mark is decorative, the name is read.
 */
export function LanguageName({ language, className }: LanguageNameProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <LanguageMark language={language} className="text-ink" />
      <span lang={language}>{LANGUAGE_NATIVE_NAME[language]}</span>
    </span>
  )
}

export interface LanguageOptionLabelProps {
  language: LanguageCode
  className?: string
}

/**
 * The label of a language option in a form or a filter: the flag (21 px) and the
 * language's own name, which is the option's accessible name ("Português").
 */
export function LanguageOptionLabel({ language, className }: LanguageOptionLabelProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <LanguageFlag language={language} width={21} />
      <span lang={language}>{LANGUAGE_NATIVE_NAME[language]}</span>
    </span>
  )
}
