import { useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { UserPlus, UsersRound } from 'lucide-react'
import { adminAuditPath, adminUserPath } from '@/app/paths'
import {
  Button,
  Callout,
  EmptyState,
  Field,
  Input,
  Kicker,
  LanguageMarks,
  Spinner,
  Status,
  useToast,
} from '@/components/ui'
import { isApiProblem } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import { useTranslation } from '@/lib/i18n'
import {
  ACCOUNT_STATUS,
  TEAM_NAME_MAX_LENGTH,
  normalizeName,
  sortMembers,
  teamNotEmptyCopy,
  teamStatus,
  validateTeamName,
} from '../model'
import { useAdminTeam, useFailureHandler, useReactivateTeam, useRenameTeam } from '../hooks'
import type { AdminTeam, AdminTeamDetail, AdminTeamMember } from '../types'
import { AddMemberDialog } from './AddMemberDialog'
import { DeactivateTeamDialog } from './DeactivateTeamDialog'
import { RoleChips } from './RoleChips'

export interface TeamPanelProps {
  /** `?team=`; null = nothing selected. */
  teamId: string | null
}

/** "Equipo seleccionado" (contract §10.5). */
export function TeamPanel({ teamId }: TeamPanelProps) {
  const query = useAdminTeam(teamId)
  const { t } = useTranslation(['admin', 'common'])
  let body
  if (!teamId) {
    body = (
      <EmptyState
        size="compact"
        as="h2"
        icon={<UsersRound size={32} strokeWidth={1.6} />}
        title={t('team.none')}
        className="grow"
      />
    )
  } else if (query.data) {
    body = <TeamDetail key={query.data.team.id} detail={query.data} />
  } else if (query.isError) {
    body = isApiProblem(query.error, 'not_found') ? (
      <EmptyState size="compact" as="h2" title={t('team.notFound')} className="grow" />
    ) : (
      <div className="p-5">
        <Callout
          tone="danger"
          title={t('team.loadError')}
          actions={
            <Button size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {t('common:query.errorDescription')}
        </Callout>
      </div>
    )
  } else {
    body = (
      <div className="flex grow items-center justify-center text-muted">
        <Spinner label={t('team.loading')} size={24} />
      </div>
    )
  }
  return (
    <aside
      aria-label={t('team.aside')}
      className="flex w-[400px] shrink-0 flex-col overflow-hidden border-l border-border bg-surface"
    >
      {body}
    </aside>
  )
}

function TeamDetail({ detail }: { detail: AdminTeamDetail }) {
  const { team } = detail
  const { toast } = useToast()
  const { t } = useTranslation('admin')
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
          toast({ title: t('toast.teamRenamed') })
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
      onSuccess: () => toast({ title: t('toast.teamReactivated') }),
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
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Status {...teamStatus(team)} srLabel={t('team.status')} />
          <span className="text-13 text-ink-2">
            {t('team.created', { date: formatDate(team.createdAt) })}
          </span>
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
          aria-label={t('team.nameLabel')}
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            saveName()
          }}
        >
          <Field label={t('team.nameLabel')} error={nameError} className="grow">
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
            {t('team.saveName')}
          </Button>
        </form>

        <section aria-labelledby={`${hintId}-members`} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Kicker as="h3" id={`${hintId}-members`}>
              {t('team.members', { total: team.memberCount })}
            </Kicker>
            {team.active ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<UserPlus size={14} aria-hidden="true" />}
                onClick={() => setDialog('add')}
              >
                {t('team.addMember')}
              </Button>
            ) : null}
          </div>
          {members.length === 0 ? (
            <p className="m-0 text-14 text-muted">{t('team.noMembers')}</p>
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
              {t('team.deactivate')}
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
            {t('team.reactivate')}
          </Button>
        )}
        <Link
          to={adminAuditPath(team.id)}
          className="self-start text-13 font-semibold text-accent hover:text-accent-strong"
        >
          {t('actions.seeInAudit')}
        </Link>
      </div>

      {dialog === 'add' ? <AddMemberDialog team={team} onClose={() => setDialog(null)} /> : null}
      {dialog === 'deactivate' ? (
        <DeactivateTeamDialog
          team={team}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            toast({ title: t('toast.teamDeactivated') })
          }}
        />
      ) : null}
    </>
  )
}

function MemberRow({ member }: { member: AdminTeamMember }) {
  const inactive = member.status === 'inactive'
  const { t } = useTranslation('admin')
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
        {inactive ? <Status {...ACCOUNT_STATUS.inactive} size="sm" className="shrink-0" /> : null}
      </span>
      <span className="flex flex-wrap items-center gap-2 text-12">
        <RoleChips roles={member.roles} className={cn(inactive && 'opacity-70')} />
        {member.languages.length > 0 ? (
          <LanguageMarks
            languages={member.languages}
            className={cn(inactive && 'text-muted opacity-70')}
          />
        ) : (
          <span title={t('noLanguages')} className={inactive ? 'text-muted' : 'text-ink-2'}>
            —
          </span>
        )}
      </span>
    </li>
  )
}
