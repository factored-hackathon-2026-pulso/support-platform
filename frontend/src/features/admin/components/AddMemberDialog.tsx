import { useState } from 'react'
import { Button, Callout, Dialog, Field, Select, Skeleton, useToast } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
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
  const { t } = useTranslation('admin')
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
      setPickError(t('team.addPick'))
      return
    }
    move.mutate(
      { user: chosen, teamId: team.id },
      {
        onSuccess: (change) => {
          toast({ title: t('toast.moved', { name: change.user.name, team: team.name }) })
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
      title={t('team.addTitle', { team: team.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button variant="primary" loading={move.isPending} onClick={confirm}>
            {t('team.addSubmit', { team: team.name })}
          </Button>
        </>
      }
    >
      {users.status === 'pending' ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <Field label={t('team.addField')} error={pickError}>
          <Select
            value={chosenId}
            placeholder={t('team.addPlaceholder')}
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
          {t('team.addMove', { from: chosen.team.name, to: team.name })}
        </p>
      ) : null}
      {users.isError ? <Callout tone="danger">{t('team.addLoadError')}</Callout> : null}
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Dialog>
  )
}
