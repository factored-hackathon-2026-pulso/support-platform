import { useId, useRef, useState } from 'react'
import { Button, Callout, Dialog, Field, Input } from '@/components/ui'
import { TEAM_NAME_MAX_LENGTH, normalizeName, validateTeamName } from '../model'
import { useCreateTeam, useFailureHandler } from '../hooks'
import type { AdminTeam } from '../types'

export interface CreateTeamDialogProps {
  onClose(): void
  onCreated(team: AdminTeam): void
}

/** "Nuevo equipo" (`?new=1`, contract §10.5), with one `Idempotency-Key` per open dialog. */
export function CreateTeamDialog({ onClose, onCreated }: CreateTeamDialogProps) {
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const formId = useId()
  const create = useCreateTeam()
  const handleFailure = useFailureHandler()

  function submit() {
    setFormError(null)
    const error = validateTeamName(name)
    if (error) {
      setNameError(error)
      inputRef.current?.focus()
      return
    }
    create.mutate(
      { name: normalizeName(name), idempotencyKey },
      {
        onSuccess: onCreated,
        onError: (problem) => {
          const failure = handleFailure(problem, { kind: 'team', id: '' })
          if (failure.field === 'name') {
            setNameError(failure.message)
            inputRef.current?.focus()
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
      size="sm"
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Nuevo equipo"
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={create.isPending}>
            Crear equipo
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        aria-label="Nuevo equipo"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {formError ? <Callout tone="danger">{formError}</Callout> : null}
        <Field label="Nombre" error={nameError}>
          <Input
            ref={inputRef}
            value={name}
            maxLength={TEAM_NAME_MAX_LENGTH}
            autoComplete="off"
            onChange={(event) => {
              setNameError(null)
              setName(event.target.value)
            }}
          />
        </Field>
      </form>
    </Dialog>
  )
}
