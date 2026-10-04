import { useId, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  Fact,
  SearchInput,
  Status,
  useToast,
} from '@/components/ui'
import { shortCaseId } from '@/features/conversation'
import { cn } from '@/lib/cn'
import {
  ACTIVITY_META,
  CONFIRM_PAUSED_ERROR,
  CONFIRM_PAUSED_LABEL,
  INCLUDE_AWAY_LABEL,
  PICK_ANALYST_ERROR,
  customerSeesCopy,
  describeAssignFailure,
  moreResultsLabel,
  needsPauseConfirmation,
  noMatchCopy,
  onlySpeakersCopy,
  openCountLabel,
  pausedWarning,
  reassignList,
  reassignPool,
  reassignSubmitLabel,
  unchangedToastTitle,
} from '../model'
import { useRefetchAssignmentData, useSetAssignee } from '../hooks'
import type { AssignmentResult, CaseSummary, TeamAnalyst } from '../types'
import { AnalystAvatar } from './AnalystAvatar'

export interface ReassignDialogProps {
  /** The open case as the supervisor sees it now. */
  summary: CaseSummary
  /** Every analyst of the team overview (the dialog keeps the ones who can take it). */
  analysts: readonly TeamAnalyst[]
  /** Who holds it now ("Lo atiende …"). */
  holderName: string | null
  onClose(): void
  /** A real change (`changed: true`): the screen reports it (strip or toast). */
  onReassigned(result: AssignmentResult, analyst: TeamAnalyst): void
}

/**
 * "Reasignar caso" (SuTeam.dc.html, slice 9): the exception to the automatic assignment.
 * Scales to big teams: only people who speak the case language (rule 3) are listed, three
 * suggestions by default (available, the least loaded first), a search reaches the rest
 * (up to six results, "+N más"); paused and offline people only with "Incluir a quienes
 * están en pausa o desconectados", and choosing one asks to confirm. "El cliente verá"
 * shows the notice in the case language. Mounted only while open, so it starts clean.
 */
export function ReassignDialog({
  summary,
  analysts,
  holderName,
  onClose,
  onReassigned,
}: ReassignDialogProps) {
  const assign = useSetAssignee(summary.id)
  const refetch = useRefetchAssignmentData(summary.id)
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [includeAway, setIncludeAway] = useState(false)
  const [analystId, setAnalystId] = useState<string | null>(null)
  const [confirmPaused, setConfirmPaused] = useState(false)
  /** The server said "paused" although our row did not: ask for the confirmation anyway. */
  const [serverSaysPaused, setServerSaysPaused] = useState(false)
  const [errors, setErrors] = useState<{ pick?: string; confirm?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const pickErrorId = useId()
  const confirmErrorId = useId()
  const radioName = useId()

  const pool = useMemo(
    () => reassignPool(analysts, summary, { includeAway }),
    [analysts, summary, includeAway],
  )
  const list = reassignList(pool, query, analystId)
  const chosen = analysts.find((analyst) => analyst.id === analystId) ?? null
  const askPause = chosen !== null && (needsPauseConfirmation(chosen) || serverSaysPaused)
  const more = moreResultsLabel(list.hidden)

  function choose(id: string) {
    setAnalystId(id)
    setConfirmPaused(false)
    setServerSaysPaused(false)
    setErrors({})
    setFailure(null)
  }

  function submit() {
    if (!chosen) {
      setErrors({ pick: PICK_ANALYST_ERROR })
      listRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus()
      return
    }
    if (askPause && !confirmPaused) {
      setErrors({ confirm: CONFIRM_PAUSED_ERROR })
      confirmRef.current?.focus()
      return
    }
    setFailure(null)
    assign.mutate(
      {
        analystId: chosen.id,
        expectedAnalystId: summary.assignedAnalystId,
        confirmPaused: askPause && confirmPaused,
      },
      {
        onSuccess: (result) => {
          if (!result.changed) {
            toast({ title: unchangedToastTitle(chosen.name), duration: 4000 })
          } else {
            onReassigned(result, chosen)
          }
          onClose()
        },
        onError: (error) => {
          const described = describeAssignFailure(error, {
            caseLanguage: summary.language,
            analystName: chosen.name,
          })
          switch (described.action) {
            case 'close':
              refetch()
              toast({ title: described.message, duration: 4000 })
              onClose()
              return
            case 'confirm_paused':
              setServerSaysPaused(true)
              requestAnimationFrame(() => confirmRef.current?.focus())
              break
            case 'refetch':
              refetch()
              break
            case 'refetch_team':
              refetch('team')
              break
            default:
              break
          }
          setFailure(described.message)
        },
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Reasignar caso"
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-ink">{summary.customer.displayName}</span>
          <span className="font-mono">{shortCaseId(summary.id)}</span>
          <Fact
            icon="languages"
            text=""
            languages={[summary.language]}
            label="Idioma"
            size="md"
            focusable={false}
          />
          <Fact
            icon="user"
            text={`Lo atiende ${holderName ?? 'otra persona del equipo'}`}
            size="md"
            focusable={false}
          />
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={assign.isPending} onClick={submit}>
            {reassignSubmitLabel(chosen)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {failure ? (
          <Callout tone="danger" title="No se reasignó">
            {failure}
          </Callout>
        ) : null}
        <fieldset
          className="m-0 flex flex-col gap-2.5 border-0 p-0"
          aria-describedby={errors.pick ? pickErrorId : undefined}
        >
          <legend className="mb-1 p-0 text-14 font-semibold text-ink">
            ¿A quién? <span aria-hidden="true">*</span>
          </legend>
          <SearchInput
            aria-label="Buscar a alguien del equipo"
            placeholder="Buscar a alguien del equipo"
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-12 font-semibold tracking-kicker text-muted uppercase">
              {list.title}
            </span>
            <Fact icon="languages" text={onlySpeakersCopy(summary.language)} tone="muted" />
          </div>
          <div
            ref={listRef}
            role="radiogroup"
            aria-label="Personas"
            aria-required="true"
            className="flex flex-col gap-1"
          >
            {list.shown.map((analyst) => {
              const checked = analyst.id === analystId
              return (
                <label
                  key={analyst.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-10 px-2.5 py-2 text-14 has-focus-visible:outline-2 has-focus-visible:outline-accent',
                    checked ? 'bg-canvas outline-2 outline-ink' : 'hover:bg-subtle',
                  )}
                >
                  <input
                    type="radio"
                    name={radioName}
                    value={analyst.id}
                    checked={checked}
                    onChange={() => choose(analyst.id)}
                    className="sr-only"
                  />
                  <AnalystAvatar name={analyst.name} activity={analyst.activity} />
                  <span className={cn('grow truncate', checked && 'font-semibold')}>
                    {analyst.name}
                  </span>
                  <Status {...ACTIVITY_META[analyst.activity]} size="sm" />
                  <span className="w-20 shrink-0 text-right text-12 text-muted">
                    {openCountLabel(analyst)}
                  </span>
                  <Check
                    size={15}
                    aria-hidden="true"
                    className={cn('shrink-0', checked ? 'text-ink' : 'invisible')}
                  />
                </label>
              )
            })}
            {list.shown.length === 0 ? (
              <span className="px-2.5 py-2 text-13 text-muted">
                {noMatchCopy(summary.language)}
              </span>
            ) : null}
            {more ? <span className="px-2.5 text-12 text-muted">{more}</span> : null}
          </div>
          {errors.pick ? (
            <span id={pickErrorId} className="text-13 font-medium text-danger-strong">
              {errors.pick}
            </span>
          ) : null}
          <Checkbox
            label={INCLUDE_AWAY_LABEL}
            checked={includeAway}
            onChange={(event) => setIncludeAway(event.target.checked)}
          />
        </fieldset>
        {chosen && askPause ? (
          <div className="flex flex-col gap-2">
            <Callout tone="warn" icon>
              {pausedWarning(chosen)}
            </Callout>
            <Checkbox
              ref={confirmRef}
              label={CONFIRM_PAUSED_LABEL}
              checked={confirmPaused}
              required
              aria-invalid={errors.confirm ? true : undefined}
              aria-describedby={errors.confirm ? confirmErrorId : undefined}
              onChange={(event) => {
                setConfirmPaused(event.target.checked)
                setErrors({})
              }}
            />
            {errors.confirm ? (
              <span id={confirmErrorId} className="text-13 font-medium text-danger-strong">
                {errors.confirm}
              </span>
            ) : null}
          </div>
        ) : null}
        {chosen ? (
          <Callout tone="neutral" title="El cliente verá">
            <span lang={summary.language}>{customerSeesCopy(summary, chosen)}</span>
          </Callout>
        ) : null}
      </div>
    </Dialog>
  )
}
