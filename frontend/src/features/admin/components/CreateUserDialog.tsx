import { useId, useRef, useState } from 'react'
import { Button, Callout, Dialog } from '@/components/ui'
import {
  EMPTY_USER_DRAFT,
  createUserBody,
  firstInvalidField,
  validateUserDraft,
  type UserDraft,
  type UserDraftErrors,
  type UserDraftField,
} from '../model'
import { useCreateUser, useFailureHandler } from '../hooks'
import type { AdminTeam, CreatedUser } from '../types'
import { UserForm, type UserFormControls } from './UserForm'

export interface CreateUserDialogProps {
  teams: readonly AdminTeam[]
  /** Preselected team (the list filters one active team). */
  initialTeamId: string | null
  onClose(): void
  onCreated(result: CreatedUser): void
}

/**
 * "Nuevo usuario" (`?nueva=1`, contract §10.3): the person form, empty, and
 * "Crear cuenta". The create carries one `Idempotency-Key` per open dialog, so
 * a retry after a lost response never creates the person twice.
 */
export function CreateUserDialog({
  teams,
  initialTeamId,
  onClose,
  onCreated,
}: CreateUserDialogProps) {
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [draft, setDraft] = useState<UserDraft>(() => ({
    ...EMPTY_USER_DRAFT,
    teamId: initialTeamId ?? '',
  }))
  const [errors, setErrors] = useState<UserDraftErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const controls = useRef<UserFormControls>({})
  const formId = useId()
  const create = useCreateUser()
  const handleFailure = useFailureHandler()

  function focusField(field: UserDraftField | null) {
    if (field) controls.current[field]?.focus()
  }

  function submit() {
    setFormError(null)
    const found = validateUserDraft(draft)
    if (Object.keys(found).length > 0) {
      setErrors(found)
      focusField(firstInvalidField(found))
      return
    }
    create.mutate(
      { body: createUserBody(draft), idempotencyKey },
      {
        onSuccess: onCreated,
        onError: (problem) => {
          const failure = handleFailure(problem, { kind: 'user', id: '' })
          if (failure.field) {
            setErrors({ [failure.field]: failure.message })
            focusField(failure.field)
          } else {
            setFormError(failure.message)
          }
        },
      },
    )
  }

  return (
    <Dialog
      open
      size="md"
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Nuevo usuario"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={create.isPending}>
            Crear cuenta
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        aria-label="Nuevo usuario"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {formError ? <Callout tone="danger">{formError}</Callout> : null}
        <UserForm
          draft={draft}
          errors={errors}
          onChange={(next) => {
            setDraft(next)
            setErrors({})
          }}
          teams={teams}
          controls={controls}
        />
      </form>
    </Dialog>
  )
}
