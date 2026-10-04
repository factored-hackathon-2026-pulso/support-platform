import { useId, useRef, useState } from 'react'
import { Mail, UserPlus } from 'lucide-react'
import { Button, Callout, Dialog } from '@/components/ui'
import {
  EMPTY_USER_DRAFT,
  INVITATION_INFO,
  createUserBody,
  firstInvalidField,
  validateUserDraft,
  type UserDraft,
  type UserDraftErrors,
  type UserDraftField,
} from '../model'
import { useCreateUser, useFailureHandler } from '../hooks'
import type { AdminTeam, InvitedUser } from '../types'
import { UserForm, type UserFormControls } from './UserForm'

export interface CreateUserDialogProps {
  teams: readonly AdminTeam[]
  /** Preselected team (the list filters one active team). */
  initialTeamId: string | null
  onClose(): void
  onCreated(result: InvitedUser): void
}

/**
 * "Nuevo usuario" (`?nueva=1`, Admin.dc.html `nuevo`, part 4): the person form,
 * empty, the invitation note and "Enviar invitación". Nobody types or sees a
 * password: she gets a link by email. The create carries one `Idempotency-Key` per
 * open dialog, so a retry after a lost response never invites the person twice.
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
      title={
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-10 bg-accent-soft text-accent-strong"
          >
            <UserPlus size={18} />
          </span>
          Nuevo usuario
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            icon={<Mail size={16} aria-hidden="true" />}
            loading={create.isPending}
          >
            Enviar invitación
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
        <div className="flex gap-2.5 rounded-10 bg-canvas px-3.5 py-3 text-13 leading-[1.45] text-ink-2">
          <Mail size={16} aria-hidden="true" className="mt-px shrink-0" />
          <span className="flex flex-col gap-0.5">
            <span className="text-14 font-semibold text-ink">{INVITATION_INFO.title}</span>
            <span>{INVITATION_INFO.text}</span>
          </span>
        </div>
      </form>
    </Dialog>
  )
}
