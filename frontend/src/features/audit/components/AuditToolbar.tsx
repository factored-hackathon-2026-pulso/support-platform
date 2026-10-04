import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import {
  Button,
  Checkbox,
  Field,
  Input,
  SearchInput,
  SegmentedControl,
  Select,
} from '@/components/ui'
import { shortCaseId } from '@/features/conversation'
import { useDebouncedValue } from '@/lib/hooks'
import {
  AUDIT_FAMILIES,
  AUDIT_KIND_FILTERS,
  AUDIT_SEARCH_MAX_LENGTH,
  clearAuditFilters,
  dateRangeError,
  hasAuditFilters,
  personOptionLabel,
  showsPersonFilter,
  withActorKind,
} from '../model'
import type { AuditStateChangeOptions, AuditUrlState } from '../url'
import { useStaffDirectory } from '../hooks'
import type { AuditActorKind, AuditFamily } from '../types'

/** Typing in "Buscar" updates the URL (and the request) once it pauses this long. */
export const AUDIT_SEARCH_DEBOUNCE_MS = 300

const ALL = ''
const KIND_ALL = 'todos'

type StateChange = (patch: Partial<AuditUrlState>, options?: AuditStateChangeOptions) => void

/** Header search: ids of cases, customers or people (the API matches ids only). */
export function AuditSearch({ value, onChange }: { value: string; onChange(query: string): void }) {
  const [draft, setDraft] = useState(value)
  const [synced, setSynced] = useState(value)
  // The URL changed from outside ("Limpiar filtros", back button): show it.
  if (value !== synced) {
    setSynced(value)
    setDraft(value)
  }
  const debounced = useDebouncedValue(draft, AUDIT_SEARCH_DEBOUNCE_MS)
  useEffect(() => {
    // Only a settled draft that differs from the URL is pushed.
    if (debounced === draft && debounced !== value) onChange(debounced)
  }, [debounced, draft, value, onChange])

  return (
    <SearchInput
      aria-label="Buscar"
      placeholder="Buscar por id de caso, cliente o persona"
      maxLength={AUDIT_SEARCH_MAX_LENGTH}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      className="w-[340px]"
    />
  )
}

export interface AuditToolbarProps {
  state: AuditUrlState
  onStateChange: StateChange
  onRefresh(): void
  refreshing: boolean
}

/**
 * Filters of the log (SuAudit, contract §8.8): Quién · Tipo · Persona · Desde /
 * Hasta (viewer's zone) · "Solo acciones que cambian algo" · the case chip ·
 * "Limpiar filtros" · "Actualizar". Every change replaces the history entry.
 */
export function AuditToolbar({ state, onStateChange, onRefresh, refreshing }: AuditToolbarProps) {
  const staff = useStaffDirectory()
  const replace = (patch: Partial<AuditUrlState>) => onStateChange(patch, { replace: true })
  const rangeError = dateRangeError(state)

  const people = [...(staff.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
  )
  const personOptions = [
    { value: ALL, label: 'Todas las personas' },
    ...people.map((person) => ({ value: person.id, label: personOptionLabel(person) })),
  ]
  if (state.actorId && !people.some((person) => person.id === state.actorId)) {
    personOptions.push({ value: state.actorId, label: state.actorId })
  }

  return (
    <div className="flex shrink-0 flex-col gap-2.5 border-b border-border px-7 py-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SegmentedControl<string>
          label="Quién"
          variant="pills"
          value={state.actorKind ?? KIND_ALL}
          onValueChange={(value) => {
            const kind = value === KIND_ALL ? null : (value as AuditActorKind)
            replace(withActorKind(state, kind))
          }}
          options={AUDIT_KIND_FILTERS.map((option) => ({
            value: option.value ?? KIND_ALL,
            label: option.label,
          }))}
        />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Tipo" className="w-[180px]">
            <Select
              size="sm"
              value={state.family ?? ALL}
              onChange={(event) =>
                replace({ family: (event.target.value || null) as AuditFamily | null })
              }
              options={[
                { value: ALL, label: 'Todos los tipos' },
                ...AUDIT_FAMILIES.map((family) => ({ value: family.value, label: family.label })),
              ]}
            />
          </Field>
          {showsPersonFilter(state) ? (
            <Field label="Persona" className="w-[200px]">
              <Select
                size="sm"
                value={state.actorId ?? ALL}
                onChange={(event) => replace({ actorId: event.target.value || null })}
                options={personOptions}
              />
            </Field>
          ) : null}
          <Field label="Desde" className="w-[150px]">
            <Input
              size="sm"
              type="date"
              value={state.fromDate ?? ''}
              onChange={(event) => replace({ fromDate: event.target.value || null })}
            />
          </Field>
          <Field label="Hasta" error={rangeError} className="w-[150px]">
            <Input
              size="sm"
              type="date"
              value={state.toDate ?? ''}
              onChange={(event) => replace({ toDate: event.target.value || null })}
            />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Checkbox
          label="Solo acciones que cambian algo"
          checked={state.changesOnly}
          onChange={(event) => replace({ changesOnly: event.target.checked })}
          className="font-semibold"
        />
        {state.caseId ? (
          <Button
            size="sm"
            variant="secondary"
            iconEnd={<X size={14} aria-hidden="true" />}
            aria-label={`Quitar el filtro del caso ${state.caseId}`}
            onClick={() => replace({ caseId: null })}
          >
            Caso <span className="font-mono text-12">{shortCaseId(state.caseId)}</span>
          </Button>
        ) : null}
        <span className="grow" />
        {hasAuditFilters(state) ? (
          <Button size="sm" variant="ghost" onClick={() => replace(clearAuditFilters(state))}>
            Limpiar filtros
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={14} aria-hidden="true" />}
          loading={refreshing}
          onClick={onRefresh}
        >
          Actualizar
        </Button>
      </div>
    </div>
  )
}
