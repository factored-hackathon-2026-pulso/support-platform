import { useState } from 'react'
import { Button, Callout, Dialog, Field, Select, Skeleton, useToast } from '@/components/ui'
import { addMemberCandidates } from '../model'
import { useAdminUsers, useFailureHandler, useMoveToTeam } from '../hooks'
import type { AdminTeam } from '../types'

export interface AddMemberDialogProps {
  team: AdminTeam
  onClose(): void
}

/**
 * "Agregar a {equipo}" (contract §10.5): an active person from another team
 * moves here through her PATCH (`teamId` + her `version`). The people come from
 * the default directory list (active accounts).
 */
export function AddMemberDialog({ team, onClose }: AddMemberDialogProps) {
  const { toast } = useToast()
  const users = useAdminUsers({})
  const move = useMoveToTeam()
  const handleFailure = useFailureHandler()
  const [chosenId, setChosenId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)

  const candidates = addMemberCandidates(users.data?.items ?? [], team.id)
  const chosen = candidates.find((candidate) => candidate.value === chosenId)?.user

  function confirm() {
    setError(null)
    if (!chosen) {
      setPickError('Elige a quién mover.')
      return
    }
    move.mutate(
      { user: chosen, teamId: team.id },
      {
        onSuccess: (change) => {
          toast({ title: `${change.user.name} pasó a ${team.name}` })
          onClose()
        },
        onError: (problem) =>
          setError(handleFailure(problem, { kind: 'user', id: chosen.id }).message),
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
      title={`Agregar a ${team.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={move.isPending} onClick={confirm}>
            {`Mover a ${team.name}`}
          </Button>
        </>
      }
    >
      {users.status === 'pending' ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <Field label="Persona" error={pickError}>
          <Select
            value={chosenId}
            placeholder="Elige a una persona"
            options={candidates.map(({ value, label }) => ({ value, label }))}
            onChange={(event) => {
              setPickError(null)
              setChosenId(event.target.value)
            }}
          />
        </Field>
      )}
      {chosen ? (
        <p className="m-0 text-14 text-ink-2">
          Pasa de {chosen.team.name} a {team.name}.
        </p>
      ) : null}
      {users.isError ? (
        <Callout tone="danger">No pudimos cargar las personas. Inténtalo de nuevo.</Callout>
      ) : null}
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Dialog>
  )
}
