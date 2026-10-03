import { useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { UserPlus, UsersRound } from 'lucide-react'
import { adminAuditPath, adminUserPath } from '@/app/roles'
import {
  Button,
  Callout,
  EmptyState,
  Field,
  Input,
  Kicker,
  Spinner,
  useToast,
} from '@/components/ui'
import { isApiProblem } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import {
  ACCOUNT_STATUS_LABEL,
  TEAM_NAME_MAX_LENGTH,
  languagesLabel,
  normalizeName,
  sortMembers,
  teamNotEmptyCopy,
  validateTeamName,
} from '../model'
import { useAdminTeam, useFailureHandler, useReactivateTeam, useRenameTeam } from '../hooks'
import type { AdminTeam, AdminTeamDetail, AdminTeamMember } from '../types'
import { AddMemberDialog } from './AddMemberDialog'
import { DeactivateTeamDialog } from './DeactivateTeamDialog'
import { RoleChips } from './RoleChips'

export interface TeamPanelProps {
  /** `?equipo=`; null = nothing selected. */
  teamId: string | null
}

/** "Equipo seleccionado" (contract §10.5). */
export function TeamPanel({ teamId }: TeamPanelProps) {
  const query = useAdminTeam(teamId)
  let body
  if (!teamId) {
    body = (
      <EmptyState
        size="compact"
        as="h2"
        icon={<UsersRound size={32} strokeWidth={1.6} />}
        title="Elige un equipo para ver sus personas."
        className="grow"
      />
    )
  } else if (query.data) {
    body = <TeamDetail key={query.data.team.id} detail={query.data} />
  } else if (query.isError) {
    body = isApiProblem(query.error, 'not_found') ? (
      <EmptyState size="compact" as="h2" title="No encontramos ese equipo." className="grow" />
    ) : (
      <div className="p-5">
        <Callout
          tone="danger"
          title="No pudimos cargar el equipo"
          actions={
            <Button size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          }
        >
          Revisa tu conexión e inténtalo de nuevo.
        </Callout>
      </div>
    )
  } else {
    body = (
      <div className="flex grow items-center justify-center text-muted">
        <Spinner label="Cargando el equipo" size={24} />
      </div>
    )
  }
  return (
    <aside
      aria-label="Equipo seleccionado"
      className="flex w-[400px] shrink-0 flex-col overflow-hidden border-l border-border bg-surface"
    >
      {body}
    </aside>
  )
}

function TeamDetail({ detail }: { detail: AdminTeamDetail }) {
  const { team } = detail
  const { toast } = useToast()
  const rename = useRenameTeam(team.id)
  const reactivate = useReactivateTeam(team.id)
  const handleFailure = useFailureHandler()
  const hintId = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  const [draft, setDraft] = useState<{ base: AdminTeam; name: string } | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'danger' | 'warn'; text: string } | null>(null)
  const [dialog, setDialog] = useState<'add' | 'deactivate' | null>(null)

  const name = draft?.name ?? team.name
  const dirty = draft !== null && normalizeName(draft.name) !== draft.base.name
  const members = sortMembers(detail.members)

  function saveName() {
    if (!draft) return
    setMessage(null)
    const error = validateTeamName(draft.name)
    if (error) {
      setNameError(error)
      nameRef.current?.focus()
      return
    }
    rename.mutate(
      { name: normalizeName(draft.name), expectedVersion: draft.base.version },
      {
        onSuccess: () => {
          setDraft(null)
          setNameError(null)
          toast({ title: 'Nombre guardado' })
        },
        onError: (problem) => {
          const failure = handleFailure(problem, { kind: 'team', id: team.id })
          if (failure.action === 'use_current') {
            setDraft(null)
            setMessage({ tone: 'warn', text: failure.message })
          } else if (failure.field === 'name') {
            setNameError(failure.message)
            nameRef.current?.focus()
          } else {
            setMessage({ tone: 'danger', text: failure.message })
          }
        },
      },
    )
  }

  function onReactivate() {
    setMessage(null)
    reactivate.mutate(team.version, {
      onSuccess: () => toast({ title: 'Equipo reactivado' }),
      onError: (problem) =>
        setMessage({
          tone: 'danger',
          text: handleFailure(problem, { kind: 'team', id: team.id }).message,
        }),
    })
  }

  return (
    <>
      <div className="flex flex-col gap-1 border-b border-border-soft px-5 pt-[18px] pb-3.5">
        <h2 className="m-0 text-18 font-semibold">{team.name}</h2>
        <span className="text-13 text-ink-2">
          {team.active ? 'Activo' : 'Inactivo'} · Creado el {formatDate(team.createdAt)}
        </span>
        <span className="font-mono text-12 text-muted">{team.id}</span>
      </div>

      <div className="flex min-h-0 grow flex-col gap-4 overflow-y-auto px-5 py-3.5">
        {message ? (
          <Callout tone={message.tone} icon role="alert">
            {message.text}
          </Callout>
        ) : null}
        <form
          noValidate
          aria-label="Nombre del equipo"
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            saveName()
          }}
        >
          <Field label="Nombre del equipo" error={nameError} className="grow">
            <Input
              ref={nameRef}
              value={name}
              maxLength={TEAM_NAME_MAX_LENGTH}
              autoComplete="off"
              onChange={(event) => {
                setNameError(null)
                setDraft({ base: draft?.base ?? team, name: event.target.value })
              }}
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            disabled={!dirty}
            loading={rename.isPending}
            className={cn(nameError && 'mb-[26px]')}
          >
            Guardar nombre
          </Button>
        </form>

        <section aria-labelledby={`${hintId}-members`} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Kicker as="h3" id={`${hintId}-members`}>
              Personas ({team.memberCount})
            </Kicker>
            {team.active ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<UserPlus size={14} aria-hidden="true" />}
                onClick={() => setDialog('add')}
              >
                Agregar persona
              </Button>
            ) : null}
          </div>
          {members.length === 0 ? (
            <p className="m-0 text-14 text-muted">Este equipo no tiene personas.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {members.map((member) => (
                <MemberRow key={member.id} member={member} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-2 border-t border-border-soft px-5 py-3.5">
        {team.active ? (
          <>
            <Button
              variant="ghost"
              className="self-start text-danger hover:text-danger-strong"
              disabled={team.memberCount > 0}
              aria-describedby={team.memberCount > 0 ? `${hintId}-not-empty` : undefined}
              onClick={() => setDialog('deactivate')}
            >
              Desactivar equipo
            </Button>
            {team.memberCount > 0 ? (
              <span id={`${hintId}-not-empty`} className="text-12 text-muted">
                {teamNotEmptyCopy(team.memberCount)}
              </span>
            ) : null}
          </>
        ) : (
          <Button
            variant="secondary"
            className="self-start"
            loading={reactivate.isPending}
            onClick={onReactivate}
          >
            Reactivar equipo
          </Button>
        )}
        <Link
          to={adminAuditPath(team.id)}
          className="self-start text-13 font-semibold text-accent hover:text-accent-strong"
        >
          Ver en auditoría
        </Link>
      </div>

      {dialog === 'add' ? <AddMemberDialog team={team} onClose={() => setDialog(null)} /> : null}
      {dialog === 'deactivate' ? (
        <DeactivateTeamDialog
          team={team}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            toast({ title: 'Equipo desactivado' })
          }}
        />
      ) : null}
    </>
  )
}

function MemberRow({ member }: { member: AdminTeamMember }) {
  const inactive = member.status === 'inactive'
  return (
    <li
      className={cn(
        'flex flex-col gap-1 border-b border-border-soft py-2 last:border-b-0',
        inactive && 'text-muted',
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <Link
          to={adminUserPath(member.id)}
          className={cn(
            'truncate text-14 font-semibold hover:text-accent',
            inactive ? 'text-muted' : 'text-ink',
          )}
        >
          {member.name}
        </Link>
        {inactive ? (
          <span className="shrink-0 text-12">{ACCOUNT_STATUS_LABEL.inactive}</span>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-2 text-12">
        <RoleChips roles={member.roles} className={cn(inactive && 'opacity-70')} />
        <span className={inactive ? 'text-muted' : 'text-ink-2'}>
          {languagesLabel(member.languages)}
        </span>
      </span>
    </li>
  )
}
