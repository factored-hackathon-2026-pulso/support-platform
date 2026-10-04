import { useEffect, useState } from 'react'
import {
  FilterChips,
  FilterMenu,
  SearchInput,
  activeFilterChips,
  toggleFilter,
  type FilterGroup,
} from '@/components/ui'
import { useDebouncedValue } from '@/lib/hooks'
import {
  USER_SEARCH_MAX_LENGTH,
  clearUserFilters,
  userFilterSelection,
  usersPatchOfSelection,
  usersShownLabel,
} from '../model'
import type { UrlStateChangeOptions, UsersUrlState } from '../url'

/** Typing in "Buscar persona" updates the URL (and the request) once it pauses this long. */
export const USER_SEARCH_DEBOUNCE_MS = 300

export interface UsersToolbarProps {
  state: UsersUrlState
  onStateChange(patch: Partial<UsersUrlState>, options?: UrlStateChangeOptions): void
  /** The groups of "Filtros" with their faceted counts (`userFilterGroups`). */
  groups: readonly FilterGroup[]
  /** Rows shown after the filters, and the people the search found (undefined while loading). */
  shown: number | undefined
  total: number | undefined
}

/**
 * The directory's toolbar (Admin.dc.html, slice 9): the debounced search, one
 * "Filtros" dropdown (Rol, Estado, Equipo, Idioma with faceted counts), "n de N
 * personas", and the active filters as removable chips with "Limpiar filtros".
 * Never pill rows or selects. Every change replaces the history entry.
 */
export function UsersToolbar({ state, onStateChange, groups, shown, total }: UsersToolbarProps) {
  const replace = (patch: Partial<UsersUrlState>) => onStateChange(patch, { replace: true })
  const selection = userFilterSelection(state)
  const toggle = (group: string, value: string) =>
    replace(usersPatchOfSelection(toggleFilter(selection, group, value)))
  const clear = () => replace({ ...clearUserFilters(state), query: state.query })
  const chips = activeFilterChips(groups, selection)

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border px-7 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <UserSearch value={state.query} onChange={(query) => replace({ query })} />
        <FilterMenu groups={groups} selection={selection} onToggle={toggle} onClear={clear} />
        {shown !== undefined && total !== undefined ? (
          <span className="text-13 text-muted">{usersShownLabel(shown, total)}</span>
        ) : null}
      </div>
      <FilterChips chips={chips} onRemove={toggle} onClear={clear} />
    </div>
  )
}

/** "Buscar persona": name, email or id (the API matches accent-insensitive, ≤ 80). */
function UserSearch({ value, onChange }: { value: string; onChange(query: string): void }) {
  const [draft, setDraft] = useState(value)
  const [synced, setSynced] = useState(value)
  // The URL changed from outside ("Limpiar filtros", back button): show it.
  if (value !== synced) {
    setSynced(value)
    setDraft(value)
  }
  const debounced = useDebouncedValue(draft, USER_SEARCH_DEBOUNCE_MS)
  useEffect(() => {
    // Only a settled draft that differs from the URL is pushed.
    if (debounced === draft && debounced !== value) onChange(debounced)
  }, [debounced, draft, value, onChange])

  return (
    <SearchInput
      size="sm"
      aria-label="Buscar persona"
      placeholder="Buscar por nombre, correo o id"
      maxLength={USER_SEARCH_MAX_LENGTH}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      className="w-[300px]"
    />
  )
}
