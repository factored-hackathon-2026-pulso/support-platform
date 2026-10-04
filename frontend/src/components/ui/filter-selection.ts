/** Pure helpers and types of the "Filtros" dropdown (FilterMenu.tsx). */
import type { LanguageCode } from './language'

/** One checkbox of a filter group: "Por responder", with how many rows it would show. */
export interface FilterOption {
  value: string
  label: string
  /** How many rows match this option (with the other groups applied); absent = no count. */
  count?: number
  /**
   * A language option: the row shows the flag and the language's own name, the chip
   * its mark; `label` is then that name ("Português").
   */
  language?: LanguageCode
}

/** One group of the dropdown ("Estado", "Prioridad", "Analista"): any of its options. */
export interface FilterGroup {
  key: string
  legend: string
  options: readonly FilterOption[]
}

/** One active filter, as a chip ("Por responder"). */
export interface ActiveFilterChip {
  groupKey: string
  value: string
  label: string
  /** A language chip shows its mark (flag + code); `label` names it. */
  language?: LanguageCode
}

/** The checked values per group key. */
export type FilterSelection = Readonly<Record<string, readonly string[]>>

/** How many options are checked across the groups (the count on the button). */
export function countSelected(selection: FilterSelection): number {
  return Object.values(selection).reduce((sum, values) => sum + values.length, 0)
}

/** The chips of the checked options, in the groups' order. */
export function activeFilterChips(
  groups: readonly FilterGroup[],
  selection: FilterSelection,
): ActiveFilterChip[] {
  return groups.flatMap((group) =>
    group.options
      .filter((option) => selection[group.key]?.includes(option.value))
      .map((option) => ({
        groupKey: group.key,
        value: option.value,
        label: option.label,
        ...(option.language ? { language: option.language } : {}),
      })),
  )
}

/** Toggle one value in a selection (pure: the screens keep the selection in the URL or state). */
export function toggleFilter(
  selection: FilterSelection,
  groupKey: string,
  value: string,
): Record<string, string[]> {
  const next: Record<string, string[]> = {}
  for (const [key, values] of Object.entries(selection)) next[key] = [...values]
  const current = next[groupKey] ?? []
  next[groupKey] = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]
  return next
}
