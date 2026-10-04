import { useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Copy, Mail, UserRound } from 'lucide-react'
import { adminAuditPath } from '@/app/paths'
import {
  Button,
  Callout,
  EmptyState,
  FactList,
  IconButton,
  KeyValueList,
  Spinner,
  useToast,
} from '@/components/ui'
import { isApiProblem } from '@/lib/api'
import { RoleChips } from './RoleChips'
import { formatDate, formatRelativeTime } from '@/lib/format'
import {
  cancelledInvitationToast,
  deactivatedToast,
  draftFromUser,
  invitationExpired,
  invitationFacts,
  firstInvalidField,
  isDraftDirty,
  openCaseBlocks,
  openCasesFact,
  reactivatedToast,
  resentInvitationToast,
  resetLinkSentToast,
  secondFactorLabel,
  statusCallout,
  unlockedToast,
  userChanges,
  userGuardState,
  userSummaryFacts,
  validateUserDraft,
  type UserDraft,
  type UserDraftErrors,
  type UserDraftField,
} from '../model'
import {
  useAdminUser,
  useFailureHandler,
  useReactivateUser,
  useReadAdminUserNow,
  useResendInvitation,
  useUnlockUser,
  useUpdateUser,
} from '../hooks'
import type { AdminTeam, AdminUser, AdminUserChange } from '../types'
import { AccountStatusText } from './AccountStatusText'
import { CancelInvitationDialog } from './CancelInvitationDialog'
import { DeactivateUserDialog } from './DeactivateUserDialog'
import { ResetPasswordDialog } from './ResetPasswordDialog'
import { UserForm, type UserFormControls } from './UserForm'

export interface UserPanelProps {
  /** `?person=`; null = nothing selected. */
  staffId: string | null
  teams: readonly AdminTeam[]
  now: number
  canOpenSupervision: boolean
  /** Her invitation was cancelled: she leaves the directory (the screen deselects her). */
  onInvitationCancelled(): void
}

/**
 * "Persona seleccionada" (Admin `usuarios` aside, contract §10.2): who she is,
 * her account status, the edit form with its guard rails, the facts and the
 * account actions. A person outside the loaded list is fetched by id. Part 4: an
 * invited person shows her invitation (sent, expires) and "Reenviar invitación" /
 * "Cancelar invitación"; an active one gets "Enviar enlace para restablecer".
 */
export function UserPanel({
  staffId,
  teams,
  now,
  canOpenSupervision,
  onInvitationCancelled,
}: UserPanelProps) {
  const query = useAdminUser(staffId)
  let body
  if (!staffId) {
    body = (
      <EmptyState
        size="compact"
        as="h2"
        icon={<UserRound size={32} strokeWidth={1.6} />}
        title="Elige una persona para ver y editar su cuenta."
        className="grow"
      />
    )
  } else if (query.data) {
    body = (
      <UserDetail
        key={query.data.id}
        user={query.data}
        teams={teams}
        now={now}
        canOpenSupervision={canOpenSupervision}
        onInvitationCancelled={onInvitationCancelled}
      />
    )
  } else if (query.isError) {
    body = isApiProblem(query.error, 'not_found') ? (
      <EmptyState size="compact" as="h2" title="No encontramos a esa persona." className="grow" />
    ) : (
      <div className="p-5">
        <Callout
          tone="danger"
          title="No pudimos cargar a esta persona"
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
        <Spinner label="Cargando la persona" size={24} />
      </div>
    )
  }
  return (
    <aside
      aria-label="Persona seleccionada"
      className="flex w-[400px] shrink-0 flex-col overflow-hidden border-l border-border bg-surface"
    >
      {body}
    </aside>
  )
}

interface DraftState {
  /** The person as the admin saw her when she started editing (`expectedVersion`). */
  base: AdminUser
  values: UserDraft
}

interface UserDetailProps extends Omit<UserPanelProps, 'staffId'> {
  user: AdminUser
}

function UserDetail({
  user,
  teams,
  now,
  canOpenSupervision,
  onInvitationCancelled,
}: UserDetailProps) {
  const { toast } = useToast()
  const update = useUpdateUser(user.id)
  const resend = useResendInvitation(user.id)
  const unlock = useUnlockUser(user.id)
  const reactivate = useReactivateUser(user.id)
  const handleFailure = useFailureHandler()
  const readNow = useReadAdminUserNow()
  const controls = useRef<UserFormControls>({})
  const hintId = useId()

  const [draft, setDraft] = useState<DraftState | null>(null)
  const [errors, setErrors] = useState<UserDraftErrors>({})
  /** Form-level message (danger) or the conflict notice after a `version_conflict`. */
  const [message, setMessage] = useState<{ tone: 'danger' | 'warn'; text: string } | null>(null)
  const [dialog, setDialog] = useState<'reset' | 'deactivate' | 'cancel-invitation' | null>(null)
  /** Re-reading her open cases before a save they would block. */
  const [rechecking, setRechecking] = useState(false)

  // Without a draft the form follows the cache (live updates); with one it keeps it.
  const values = draft?.values ?? draftFromUser(user)
  const dirty = draft !== null && isDraftDirty(draft.base, draft.values)
  const stale = dirty && draft !== null && user.version > draft.base.version
  const guards = userGuardState(user)
  const callout = statusCallout(user, now)
  const inactive = user.status === 'inactive'
  const invited = user.status === 'invited'
  const cancelled = user.status === 'cancelled'
  const invitation = invited ? user.invitation : null
  const secondFactor = secondFactorLabel(user.secondFactor)

  function focusField(field: UserDraftField | null) {
    if (field) controls.current[field]?.focus()
  }

  function onChange(next: UserDraft) {
    const base = draft?.base ?? user
    setDraft(isDraftDirty(base, next) ? { base, values: next } : null)
    // A changed field drops its own error.
    const current = values
    setErrors((previous) => {
      const kept: UserDraftErrors = {}
      for (const [field, text] of Object.entries(previous) as [UserDraftField, string][]) {
        if (JSON.stringify(current[field]) === JSON.stringify(next[field])) kept[field] = text
      }
      return kept
    })
  }

  async function save() {
    if (!draft) return
    setMessage(null)
    let current = user
    if (Object.keys(openCaseBlocks(user, draft.values)).length > 0) {
      // The cached open cases may be stale (supervision may have reassigned
      // them): ask again before blocking (contract §3.6).
      setRechecking(true)
      current = (await readNow(user.id)) ?? user
      setRechecking(false)
    }
    // Validation errors win over the open-case blocks of the same field.
    const found = { ...openCaseBlocks(current, draft.values), ...validateUserDraft(draft.values) }
    if (Object.keys(found).length > 0) {
      setErrors(found)
      focusField(firstInvalidField(found))
      return
    }
    update.mutate(
      { expectedVersion: draft.base.version, ...userChanges(draft.base, draft.values) },
      {
        onSuccess: () => {
          setDraft(null)
          setErrors({})
          toast({ title: 'Cambios guardados' })
        },
        onError: (problem) => {
          const failure = handleFailure(problem, { kind: 'user', id: user.id })
          if (failure.action === 'use_current') {
            setDraft(null)
            setErrors({})
            setMessage({ tone: 'warn', text: failure.message })
          } else if (failure.field) {
            setErrors({ [failure.field]: failure.message })
            focusField(failure.field)
          } else {
            setMessage({ tone: 'danger', text: failure.message })
          }
        },
      },
    )
  }

  function onAccountAction(action: 'unlock' | 'reactivate') {
    setMessage(null)
    const onError = (problem: unknown) =>
      setMessage({
        tone: 'danger',
        text: handleFailure(problem, { kind: 'user', id: user.id }).message,
      })
    if (action === 'unlock') {
      unlock.mutate(undefined, {
        onSuccess: (change) => toast(unlockedToast(user.name, change.changed)),
        onError,
      })
    } else {
      reactivate.mutate(user.version, {
        onSuccess: () => toast(reactivatedToast(user.name)),
        onError,
      })
    }
  }

  function onResend() {
    setMessage(null)
    resend.mutate(undefined, {
      onSuccess: () => toast(resentInvitationToast(user.email)),
      onError: (problem) =>
        setMessage({
          tone: 'danger',
          text: handleFailure(problem, { kind: 'user', id: user.id }).message,
        }),
    })
  }

  function onDeactivated(change: AdminUserChange) {
    setDialog(null)
    setDraft(null)
    toast(deactivatedToast(user.name, change.revokedSessions))
  }

  function copyId() {
    void navigator.clipboard?.writeText(user.id).then(
      () => toast({ title: 'Id copiado', description: user.id, duration: 3000 }),
      () => undefined,
    )
  }

  return (
    <>
      <div className="flex flex-col gap-1 border-b border-border-soft px-5 pt-[18px] pb-3.5">
        <h2 className="m-0 text-18 font-semibold">{user.name}</h2>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <RoleChips roles={user.roles} />
          <FactList items={userSummaryFacts(user)} size="md" />
          <AccountStatusText user={user} now={now} />
        </span>
        <span className="flex items-center gap-1 font-mono text-12 text-muted">
          {user.id}
          <IconButton
            size="sm"
            variant="ghost"
            className="-my-1.5 size-6 text-muted"
            aria-label="Copiar id de la persona"
            icon={<Copy size={13} aria-hidden="true" />}
            onClick={copyId}
          />
        </span>
      </div>

      <form
        noValidate
        aria-label={`Cuenta de ${user.name}`}
        className="flex min-h-0 grow flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex min-h-0 grow flex-col gap-4 overflow-y-auto px-5 py-3.5">
          {callout ? (
            <Callout
              tone={callout.tone}
              title={callout.title}
              actions={
                callout.action === 'unlock' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={unlock.isPending}
                    onClick={() => onAccountAction('unlock')}
                  >
                    Desbloquear
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={reactivate.isPending}
                    onClick={() => onAccountAction('reactivate')}
                  >
                    Reactivar cuenta
                  </Button>
                )
              }
            >
              {callout.text}
            </Callout>
          ) : null}
          {invitation && invitationExpired(invitation, now) ? (
            <Callout tone="warn" title="La invitación venció">
              El enlace ya no funciona. Reenvíala para enviarle uno nuevo.
            </Callout>
          ) : null}
          {cancelled ? (
            <Callout tone="neutral" title="Invitación cancelada">
              Para invitarle de nuevo, usa Nuevo usuario con el mismo correo.
            </Callout>
          ) : null}
          {stale ? (
            <Callout tone="info" icon>
              Alguien más acaba de cambiar a esta persona. Si guardas, revisaremos que no choquen
              tus cambios.
            </Callout>
          ) : null}
          {message ? (
            <Callout tone={message.tone} icon role="alert">
              {message.text}
            </Callout>
          ) : null}

          <UserForm
            draft={values}
            errors={errors}
            onChange={onChange}
            teams={teams}
            currentTeam={user.team}
            adminLocked={guards.adminLocked}
            showRolesNote
            controls={controls}
          />

          <KeyValueList
            className="border-t border-border-soft pt-3.5"
            labelWidth={120}
            items={
              invitation
                ? invitationFacts(invitation, now)
                : [
                    {
                      key: 'login',
                      label: 'Último ingreso',
                      value: user.lastLoginAt ? formatRelativeTime(user.lastLoginAt, now) : 'Nunca',
                    },
                    ...(user.availability
                      ? [
                          {
                            key: 'now',
                            label: 'Ahora',
                            value: user.availability === 'available' ? 'Disponible' : 'En pausa',
                          },
                        ]
                      : []),
                    { key: 'open', label: 'Casos abiertos', value: openCasesFact(user.openCases) },
                    ...(secondFactor
                      ? [{ key: 'mfa', label: 'Verificación en dos pasos', value: secondFactor }]
                      : []),
                    { key: 'created', label: 'Cuenta creada', value: formatDate(user.createdAt) },
                  ]
            }
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-border-soft px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={!dirty}
              loading={update.isPending || rechecking}
            >
              Guardar cambios
            </Button>
            {invited ? (
              <>
                <Button
                  variant="secondary"
                  icon={<Mail size={15} aria-hidden="true" />}
                  loading={resend.isPending}
                  onClick={onResend}
                >
                  Reenviar invitación
                </Button>
                <Button
                  variant="ghost"
                  className="text-danger hover:text-danger-strong"
                  onClick={() => setDialog('cancel-invitation')}
                >
                  Cancelar invitación
                </Button>
              </>
            ) : null}
            {!invited && !cancelled && !inactive ? (
              <Button
                variant="ghost"
                disabled={guards.resetBlocked !== null}
                aria-describedby={guards.resetBlocked ? `${hintId}-reset` : undefined}
                onClick={() => setDialog('reset')}
              >
                Enviar enlace para restablecer
              </Button>
            ) : null}
            {!inactive && !invited && !cancelled ? (
              <Button
                variant="ghost"
                className="text-danger hover:text-danger-strong"
                disabled={guards.deactivateBlocked !== null}
                aria-describedby={guards.deactivateBlocked ? `${hintId}-deactivate` : undefined}
                onClick={() => setDialog('deactivate')}
              >
                Desactivar cuenta
              </Button>
            ) : null}
          </div>
          {guards.resetBlocked && !invited && !cancelled && !inactive ? (
            <span id={`${hintId}-reset`} className="text-12 text-muted">
              {guards.resetBlocked}
            </span>
          ) : null}
          {guards.deactivateBlocked && !inactive && !invited && !cancelled ? (
            <span id={`${hintId}-deactivate`} className="text-12 text-muted">
              {guards.deactivateBlocked}
            </span>
          ) : null}
          <Link
            to={adminAuditPath(user.id)}
            className="self-start text-13 font-semibold text-accent hover:text-accent-strong"
          >
            Ver en auditoría
          </Link>
        </div>
      </form>

      {dialog === 'reset' ? (
        <ResetPasswordDialog
          user={user}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            toast(resetLinkSentToast(user.email))
          }}
        />
      ) : null}
      {dialog === 'cancel-invitation' ? (
        <CancelInvitationDialog
          user={user}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            setDraft(null)
            toast(cancelledInvitationToast(user.name))
            onInvitationCancelled()
          }}
        />
      ) : null}
      {dialog === 'deactivate' ? (
        <DeactivateUserDialog
          user={user}
          canOpenSupervision={canOpenSupervision}
          onClose={() => setDialog(null)}
          onDone={onDeactivated}
        />
      ) : null}
    </>
  )
}
