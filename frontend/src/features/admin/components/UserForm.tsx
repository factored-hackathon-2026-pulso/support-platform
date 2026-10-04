import { useId, type RefObject } from 'react'
import { Check, Languages } from 'lucide-react'
import { ROLE_LABEL, ROLE_ORDER, type RoleId } from '@/app/roles'
import { Checkbox, Field, Input, Kicker, LanguageOptionLabel, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  EMAIL_MAX_LENGTH,
  LANGUAGES,
  NAME_MAX_LENGTH,
  ROLE_DESCRIPTION,
  byName,
  teamOptionLabel,
  toggleValue,
  type UserDraft,
  type UserDraftErrors,
  type UserDraftField,
} from '../model'
import type { AdminTeam, Language, TeamRef } from '../types'

/** Controls by field, so the screen can focus the first invalid one. */
export type UserFormControls = Partial<Record<UserDraftField, HTMLElement | null>>

export interface UserFormProps {
  draft: UserDraft
  errors: UserDraftErrors
  onChange(next: UserDraft): void
  /** Every team (`GET /admin/teams?status=all`); the select offers the active ones. */
  teams: readonly AdminTeam[]
  /** The person's current team, offered even when inactive (edit only). */
  currentTeam?: TeamRef | null
  /**
   * The Administración card cannot be unchecked (self, last active admin): the
   * text replaces its description.
   */
  adminLocked?: string | null
  /** "Los cambios de rol se aplican de inmediato…" (edit only). */
  showRolesNote?: boolean
  controls: RefObject<UserFormControls>
  disabled?: boolean
}

export const ROLES_NOTE =
  'Los cambios de rol se aplican de inmediato: la persona ve su menú actualizado sin volver a ingresar.'

export const LANGUAGES_HINT =
  'Quien atiende casos necesita al menos un idioma. Los casos en portugués solo llegan a quien lo habla (regla 3).'

/**
 * The person form (Admin `usuarios` aside, contract §10.2), shared by the edit
 * aside and the create dialog: name, email, the ROLES checkbox cards, IDIOMAS
 * and the team. Controlled: the draft, its errors and the change handler come
 * from the parent, which validates on submit.
 */
export function UserForm({
  draft,
  errors,
  onChange,
  teams,
  currentTeam = null,
  adminLocked = null,
  showRolesNote = false,
  controls,
  disabled = false,
}: UserFormProps) {
  const id = useId()
  const rolesErrorId = `${id}-roles-error`
  const languagesErrorId = `${id}-languages-error`
  const languagesHintId = `${id}-languages-hint`
  const set = (patch: Partial<UserDraft>) => onChange({ ...draft, ...patch })
  const register = (field: UserDraftField) => (element: HTMLElement | null) => {
    controls.current[field] = element
  }

  const options = teams
    .filter((team) => team.active)
    .slice()
    .sort(byName)
    .map((team) => ({ value: team.id, label: teamOptionLabel(team) }))
  const currentListed = currentTeam && options.some((option) => option.value === currentTeam.id)
  if (currentTeam && !currentListed) {
    const known = teams.find((team) => team.id === currentTeam.id)
    options.unshift({
      value: currentTeam.id,
      label: known ? teamOptionLabel(known) : currentTeam.name,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Nombre completo" error={errors.name}>
        <Input
          ref={register('name')}
          value={draft.name}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>
      <Field label="Correo" error={errors.email}>
        <Input
          ref={register('email')}
          type="email"
          value={draft.email}
          maxLength={EMAIL_MAX_LENGTH}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => set({ email: event.target.value })}
        />
      </Field>

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <Kicker as="legend" className="mb-2 p-0">
          Roles
        </Kicker>
        {ROLE_ORDER.map((role, index) => {
          const locked = role === 'admin' && adminLocked !== null && draft.roles.includes('admin')
          return (
            <Checkbox
              key={role}
              ref={index === 0 ? register('roles') : undefined}
              variant="card"
              label={ROLE_LABEL[role]}
              description={locked ? adminLocked : ROLE_DESCRIPTION[role]}
              checked={draft.roles.includes(role)}
              disabled={disabled || locked}
              aria-invalid={errors.roles ? true : undefined}
              aria-describedby={errors.roles ? rolesErrorId : undefined}
              onChange={(event) =>
                set({ roles: toggleValue<RoleId>(draft.roles, role, event.target.checked) })
              }
            />
          )
        })}
        {errors.roles ? (
          <span id={rolesErrorId} className="text-13 font-medium text-danger-strong">
            {errors.roles}
          </span>
        ) : null}
        {showRolesNote ? <p className="m-0 text-12 text-ink-2">{ROLES_NOTE}</p> : null}
      </fieldset>

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <Kicker as="legend" className="mb-2 flex items-center gap-1.5 p-0">
          <Languages size={14} aria-hidden="true" />
          Idiomas
        </Kicker>
        {/*
          Option cards (Admin.dc.html): the flag and the language's own name, a native
          checkbox (visually hidden) and the round check of the selected state.
        */}
        <div className="grid grid-cols-2 gap-2">
          {LANGUAGES.map((language, index) => {
            const on = draft.languages.includes(language)
            return (
              <label
                key={language}
                className={cn(
                  'flex min-h-[52px] items-center gap-2.5 rounded-10 px-3 py-2 text-14 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
                  on ? 'border-2 border-ink bg-canvas' : 'border border-border bg-surface',
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-ink',
                )}
              >
                <input
                  ref={index === 0 ? register('languages') : undefined}
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  disabled={disabled}
                  aria-invalid={errors.languages ? true : undefined}
                  aria-describedby={
                    [errors.languages ? languagesErrorId : null, languagesHintId]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  onChange={(event) =>
                    set({
                      languages: toggleValue<Language>(
                        draft.languages,
                        language,
                        event.target.checked,
                      ),
                    })
                  }
                />
                <LanguageOptionLabel
                  language={language}
                  className="min-w-0 grow gap-2.5 font-semibold text-ink"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full',
                    on ? 'bg-ink text-white' : 'border-[1.5px] border-offline bg-surface',
                  )}
                >
                  {on ? <Check size={13} strokeWidth={3} /> : null}
                </span>
              </label>
            )
          })}
        </div>
        {errors.languages ? (
          <span id={languagesErrorId} className="text-13 font-medium text-danger-strong">
            {errors.languages}
          </span>
        ) : null}
        <span id={languagesHintId} className="text-12 text-muted">
          {LANGUAGES_HINT}
        </span>
      </fieldset>

      <Field label="Equipo" error={errors.teamId}>
        <Select
          ref={register('teamId')}
          value={draft.teamId}
          placeholder="Elige un equipo"
          disabled={disabled}
          options={options}
          onChange={(event) => set({ teamId: event.target.value })}
        />
      </Field>
    </div>
  )
}
