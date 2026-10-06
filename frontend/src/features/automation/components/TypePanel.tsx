import { useState } from 'react'
import { Link } from 'react-router'
import { Bot, Check, Clock, Tag, X } from 'lucide-react'
import { automationAgentPath, automationProposalPath } from '@/app/paths'
import {
  Button,
  Dialog,
  IconButton,
  LinkButton,
  RadioGroup,
  Status,
  useToast,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import { agentRequest } from '../builder-chat'
import {
  useAgentsServiceDown,
  useBuilderAvailable,
  useMoveStageBack,
  useProposals,
} from '../hooks/use-automation'
import {
  agentIdFor,
  agentName,
  draftBreakdown,
  lastChangeLine,
  maturitySteps,
  moveBackOptions,
  moveBackResult,
  ruleLines,
  stageView,
  typeName,
  type RuleLine,
} from '../model'
import { AgentAvatar } from './AgentAvatar'
import { describeBuilderFailure, proposalStatus } from '../proposals'
import type { CaseTypeStage, MaturingType, StageRule } from '../types'
import { EngineMissing } from './AutomationFrame'
import { useBuilderChatPanel } from './chat-panel'
import { StageBars } from './StageBars'

export interface TypePanelProps {
  type: MaturingType
  entry: CaseTypeStage
  rule: StageRule
  onClose(): void
}

/**
 * One case type (IaAutomatizacion `tipo`): how it matured, the drafts of the window, the team
 * rule's thresholds against today's signals ("Regla del equipo (ejemplo)"), moving it back, and its
 * agent: the one that serves it, or "Proponer un agente" once the system proposes one.
 */
export function TypePanel({ type, entry, rule, onClose }: TypePanelProps) {
  const { t } = useTranslation(['automation', 'cases'])
  const view = stageView(entry)
  const name = typeName(type)
  const [movingBack, setMovingBack] = useState(false)
  const options = moveBackOptions(entry)
  const lastChange = lastChangeLine(entry)
  return (
    <aside
      aria-label={t('type.panel', { type: name })}
      className="flex min-h-0 flex-col overflow-hidden rounded-12 border border-border bg-surface"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 inline-flex items-center gap-2 font-display text-18 font-semibold">
            <Tag size={16} aria-hidden="true" className="shrink-0" />
            {name}
          </h2>
          <span className="inline-flex items-center gap-2 text-13 text-ink-2">
            <StageBars bars={view.bars} agent={view.agent} />
            {view.label}
            <span className="text-muted">{view.tip}</span>
          </span>
        </div>
        <IconButton
          aria-label={t('type.close')}
          icon={<X size={16} />}
          variant="ghost"
          size="sm"
          onClick={onClose}
        />
      </header>
      <div className="flex min-h-0 grow flex-col gap-6 overflow-y-auto px-5 py-4">
        <MaturedSection entry={entry} />
        <DraftsSection entry={entry} />
        <RulesSection lines={ruleLines(entry, rule)} />
        {lastChange ? <p className="m-0 text-13 text-muted">{lastChange}</p> : null}
        <AgentSection type={type} entry={entry} />
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
        {options.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={() => setMovingBack(true)}>
            {t('type.moveBack')}
          </Button>
        ) : entry.agent === 'active' ? (
          <p className="m-0 text-13 text-ink-2">{t('type.moveBackBlocked')}</p>
        ) : null}
        {entry.agent === 'ready' ? <ProposeButton type={type} entry={entry} /> : null}
      </footer>
      {movingBack ? (
        <MoveBackDialog type={type} entry={entry} onClose={() => setMovingBack(false)} />
      ) : null}
    </aside>
  )
}

function MaturedSection({ entry }: { entry: CaseTypeStage }) {
  const { t } = useTranslation('automation')
  return (
    <section aria-labelledby="type-matured" className="flex flex-col gap-3">
      <h3 id="type-matured" className="m-0 text-14 font-semibold">
        {t('type.matured')}
      </h3>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {maturitySteps(entry).map((step) => (
          <li key={step.key} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-12 font-semibold',
                step.state === 'done' ? 'bg-accent-strong text-white' : 'bg-subtle text-muted',
              )}
            >
              {step.number ?? <Check size={13} />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-14 font-medium">{step.title}</span>
              <span className="text-12 text-muted">{step.when}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function DraftsSection({ entry }: { entry: CaseTypeStage }) {
  const { t } = useTranslation('automation')
  const drafts = draftBreakdown(entry)
  if (!drafts) return null
  const share = (n: number) => `${(n / drafts.total) * 100}%`
  return (
    <section aria-labelledby="type-drafts" className="flex flex-col gap-2">
      <h3 id="type-drafts" className="m-0 text-14 font-semibold">
        {t('type.drafts', { count: drafts.total })}
      </h3>
      <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-subtle">
        <span className="bg-success" style={{ width: share(drafts.asIs) }} />
        <span className="bg-warn" style={{ width: share(drafts.edited) }} />
        <span className="bg-offline" style={{ width: share(drafts.discarded) }} />
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-13 text-ink-2">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-success" />
          {t('type.draftsAsIs', { count: drafts.asIs })}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
          {t('type.draftsEdited', { count: drafts.edited })}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-offline" />
          {t('type.draftsDiscarded', { count: drafts.discarded })}
        </li>
      </ul>
    </section>
  )
}

function RulesSection({ lines }: { lines: RuleLine[] }) {
  const { t } = useTranslation('automation')
  return (
    <section aria-labelledby="type-rules" className="flex flex-col gap-3">
      <h3 id="type-rules" className="m-0 text-14 font-semibold">
        {t('type.rules')}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {lines.map((line) => (
          <li key={line.key} data-state={line.state} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                line.state === 'met' && 'bg-success-tint text-success-ink',
                line.state === 'current' && 'bg-accent-soft text-accent-strong',
                line.state === 'later' && 'bg-subtle text-muted',
              )}
            >
              {line.state === 'met' ? <Check size={12} /> : <Clock size={12} />}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-12 font-semibold tracking-label text-muted uppercase">
                {line.step}
              </span>
              <span className="text-14">{line.rule}</span>
              <span
                className={cn(
                  'text-13',
                  line.state === 'met' && 'text-success-ink',
                  line.state === 'current' && 'font-medium text-accent-strong',
                  line.state === 'later' && 'text-muted',
                )}
              >
                {line.now}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-12 text-muted">{t('type.ruleNote')}</p>
    </section>
  )
}

function AgentSection({ type, entry }: { type: MaturingType; entry: CaseTypeStage }) {
  const { t } = useTranslation('automation')
  const builder = useBuilderAvailable()
  const agentId = agentIdFor(entry)
  const proposals = useProposals({ enabled: builder && entry.agent !== 'none' })
  const forAgent = (proposals.data?.items ?? []).filter((p) => p.agentId === agentId)
  return (
    <section aria-labelledby="type-agent" className="flex flex-col gap-3">
      <h3 id="type-agent" className="m-0 inline-flex items-center gap-1.5 text-14 font-semibold">
        <Bot size={15} aria-hidden="true" />
        {t('type.agent')}
      </h3>
      {entry.agent === 'none' ? (
        <p className="m-0 text-13 text-ink-2">{t('type.notReady')}</p>
      ) : null}
      {entry.agent === 'active' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-14">
            <AgentAvatar avatar={entry.agentAvatar} size={24} />
            {t('type.servedBy', { agent: agentName(agentId) })}
          </span>
          {builder ? (
            <Link to={automationAgentPath(agentId)} className="text-14 text-link font-medium">
              {t('type.openAgent')}
            </Link>
          ) : null}
        </div>
      ) : null}
      {entry.agent === 'ready' ? (
        builder ? (
          <p className="m-0 text-13 text-ink-2">{t('type.proposeText')}</p>
        ) : (
          <EngineMissing />
        )
      ) : null}
      {builder && forAgent.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="m-0 text-13 font-semibold text-ink-2">
            {t('type.proposals', { agent: agentName(agentId) })}
          </h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {forAgent.map((proposal) => (
              <li key={proposal.proposalId}>
                <Link
                  to={automationProposalPath(proposal.proposalId, { type })}
                  className="flex items-center justify-between gap-3 rounded-8 px-2 py-1.5 text-14 hover:bg-subtle"
                >
                  <span className="min-w-0 truncate">{proposal.title}</span>
                  <Status {...proposalStatus(proposal.state)} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

/**
 * "Crear el agente": a new conversation with the builder and the type's request (the agent id,
 * then the goal, the order its questions take; agent-core needed). It never continues an older
 * thread.
 */
function ProposeButton({ type, entry }: { type: MaturingType; entry: CaseTypeStage }) {
  const { t } = useTranslation('automation')
  const builder = useBuilderAvailable()
  const serviceDown = useAgentsServiceDown()
  const chat = useBuilderChatPanel()
  const proposals = useProposals({ enabled: builder })
  // The agent already drafted for this type (awaiting its activation, whatever its state): Supervisión reviews it, not a second one.
  const agentId = agentIdFor(entry)
  const draft = (proposals.data?.items ?? []).find((p) => p.agentId === agentId)
  // P4: while the agents service is down the frame says so and the chat waits for it.
  if (!builder || serviceDown) return null
  if (draft) {
    return (
      <LinkButton
        to={automationProposalPath(draft.proposalId, { type })}
        variant="primary"
        size="sm"
        icon={<Bot size={16} />}
      >
        {t('type.review')}
      </LinkButton>
    )
  }
  return (
    <Button
      variant="primary"
      size="sm"
      icon={<Bot size={16} />}
      onClick={() =>
        chat.open({ request: agentRequest(type, agentIdFor(entry), entry), type, fresh: true })
      }
    >
      {t('type.propose')}
    </Button>
  )
}

function MoveBackDialog({
  type,
  entry,
  onClose,
}: {
  type: MaturingType
  entry: CaseTypeStage
  onClose(): void
}) {
  const { t } = useTranslation(['automation', 'cases'])
  const options = moveBackOptions(entry)
  const [value, setValue] = useState<string | null>(options[0] ? String(options[0].value) : null)
  const [error, setError] = useState<string | null>(null)
  const move = useMoveStageBack(type)
  const { toast } = useToast()
  const name = typeName(type)

  function submit() {
    if (value === null) return
    const toStage = Number(value)
    setError(null)
    move.mutate(toStage, {
      onSuccess: (result) => {
        toast({
          title: moveBackResult(
            type,
            toStage,
            result.changed,
            entry.agent === 'ready' && toStage === 3,
          ),
        })
        onClose()
      },
      onError: (failure) => {
        const described = describeBuilderFailure(failure)
        setError(described.kind === 'notReady' ? t('moveBack.conflict') : t('moveBack.failed'))
      },
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !move.isPending) onClose()
      }}
      title={t('moveBack.title', { type: name })}
      description={t('moveBack.description')}
      footerNote={t('moveBack.note')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={move.isPending}>
            {t('moveBack.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={move.isPending}>
            {t('moveBack.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <RadioGroup
          label={t('moveBack.label')}
          options={options.map((option) => ({ value: String(option.value), label: option.label }))}
          value={value}
          onValueChange={setValue}
        />
        {error ? (
          <p role="alert" className="m-0 text-13 text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
