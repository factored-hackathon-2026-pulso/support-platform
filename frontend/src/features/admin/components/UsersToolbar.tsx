import { useEffect, useState } from 'react'
import { Button, Field, SearchInput, SegmentedControl, Select } from '@/components/ui'
import { useDebouncedValue } from '@/lib/hooks'
import {
  LANGUAGES,
  LANGUAGE_LABEL,
  USER_SEARCH_MAX_LENGTH,
  byName,
  clearUserFilters,
  hasUserFilters,
  teamOptionLabel,
  type RolePill,
  type UrlStateChangeOptions,
  type UsersUrlState,
} from '../model'
import type { AdminTeam, Language, RoleCounts, UserStatusCounts, UserStatusFilter } from '../types'

/** Typing in "Buscar persona" updates the URL (and the request) once it pauses this long. */
export const USER_SEARCH_DEBOUNCE_MS = 300

const ALL = ''

export interface UsersToolbarProps {
  state: UsersUrlState
  onStateChange(patch: Partial<UsersUrlState>, options?: UrlStateChangeOptions): void
  roleCounts: RoleCounts | undefined
  statusCounts: UserStatusCounts | undefined
  teams: readonly AdminTeam[]
}

/**
 * Filters of the directory (contract §10.2): role pills with counts, Cuenta,
 * Equipo, Idioma, the debounced search and "Limpiar filtros". Every change
 * replaces the history entry.
 */
export function UsersToolbar({
  state,
  onStateChange,
  roleCounts,
  statusCounts,
  teams,
}: UsersToolbarProps) {
  const replace = (patch: Partial<UsersUrlState>) => onStateChange(patch, { replace: true })
  const locked = statusCounts ? ` (${statusCounts.locked})` : ''
  const teamOptions = teams
    .slice()
    .sort((a, b) => Number(b.active) - Number(a.active) || byName(a, b))
    .map((team) => ({ value: team.id, label: teamOptionLabel(team) }))
  if (state.teamId && !teams.some((team) => team.id === state.teamId)) {
    teamOptions.push({ value: state.teamId, label: state.teamId })
  }

  return (
    <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-border px-7 py-3">
      <SegmentedControl<RolePill>
        label="Rol"
        variant="pills"
        value={state.role ?? 'all'}
        onValueChange={(value) => replace({ role: value === 'all' ? null : value })}
        options={[
          { value: 'all', label: 'Todas', count: roleCounts?.all },
          { value: 'analyst', label: 'Analistas', count: roleCounts?.analyst },
          { value: 'supervisor', label: 'Supervisoras', count: roleCounts?.supervisor },
          { value: 'admin', label: 'Administración', count: roleCounts?.admin },
        ]}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Cuenta" className="w-[160px]">
          <Select
            size="sm"
            value={state.status}
            onChange={(event) => replace({ status: event.target.value as UserStatusFilter })}
            options={[
              { value: 'active', label: 'Activas' },
              { value: 'locked', label: `Bloqueadas${locked}` },
              { value: 'inactive', label: 'Desactivadas' },
              { value: 'all', label: 'Todas' },
            ]}
          />
        </Field>
        <Field label="Equipo" className="w-[220px]">
          <Select
            size="sm"
            value={state.teamId ?? ALL}
            onChange={(event) => replace({ teamId: event.target.value || null })}
            options={[{ value: ALL, label: 'Todos los equipos' }, ...teamOptions]}
          />
        </Field>
        <Field label="Idioma" className="w-[130px]">
          <Select
            size="sm"
            value={state.language ?? ALL}
            onChange={(event) =>
              replace({ language: (event.target.value || null) as Language | null })
            }
            options={[
              { value: ALL, label: 'Todos' },
              ...LANGUAGES.map((language) => ({
                value: language,
                label: LANGUAGE_LABEL[language],
              })),
            ]}
          />
        </Field>
        <UserSearch value={state.query} onChange={(query) => replace({ query })} />
        {hasUserFilters(state) ? (
          <Button size="sm" variant="ghost" onClick={() => replace(clearUserFilters(state))}>
            Limpiar filtros
          </Button>
        ) : null}
      </div>
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
      className="w-[260px]"
    />
  )
}
