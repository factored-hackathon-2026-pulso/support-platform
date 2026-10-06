import { useState } from 'react'
import { Check, Tag, Wrench } from 'lucide-react'
import { automationTypePath, PATHS } from '@/app/paths'
import { PageBody } from '@/components/layout'
import {
  Badge,
  Callout,
  EmptyState,
  LanguageMarks,
  QueryState,
  Skeleton,
  Status,
} from '@/components/ui'
import { useAiStages } from '@/features/copilot/core'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import {
  useAlias,
  useBuilderAvailable,
  useProposal,
  useProposalRecord,
} from '../hooks/use-automation'
import { agentAvatarOf, agentDisplayName, typeName, typeStage } from '../model'
import { AgentAvatar } from './AgentAvatar'
import { AgentPhotoSlot } from './AgentPhotoSlot'
import {
  announcedByEngine,
  changeView,
  draftLanguages,
  draftTools,
  endStepFor,
  proposalStatus,
  proposalSteps,
  publishedReleaseOf,
  toolName,
  type EndStep,
} from '../proposals'
import type { MaturingType, ProposalDetail, ReleaseSettingChange } from '../types'
import { AutomationFrame, EngineMissing, type Crumb } from './AutomationFrame'
import { EvaluationReport } from './EvaluationReport'
import { ImprovementDossier } from './ImprovementDossier'
import { ProposalHistory } from './ProposalHistory'
import { ProposalNextStep, type GateResult } from './ProposalNextStep'

export interface ProposalScreenProps {
  proposalId: string
  /** The case type the proposal is for (`?type=`), when it came from one. */
  type: MaturingType | null
  /** "Activar" chose the type (kept in the URL). */
  onTypeChange(type: MaturingType): void
}

/**
 * One proposal to change an agent (IaAutomatizacion `propuesta`, `prueba`, `activar`,
 * `activado` on slice 16's registry): where it is from draft to an active agent (or, for an agent
 * already in production, to production), the improvement engine's dossier when it announced it,
 * the next step (validate, prepare, test, approve, reject with a reason, publish, activate or
 * "Pasar a producción"; the decisions with her authenticator code), the test report base against
 * candidate, the history of the decisions and what the draft changes.
 */
export function ProposalScreen({ proposalId, type, onTypeChange }: ProposalScreenProps) {
  const { t } = useTranslation(['automation', 'cases'])
  const builder = useBuilderAvailable()
  const proposal = useProposal(proposalId)
  const crumbs: Crumb[] = [
    { label: t('title'), to: PATHS.supervision.automation },
    ...(type ? [{ label: typeName(type), to: automationTypePath(type) }] : []),
    { label: t('proposal.kicker') },
  ]
  const title = type
    ? t('proposal.pageTitle', { type: typeName(type) })
    : (proposal.data?.proposal.title ?? t('proposal.kicker'))
  return (
    <AutomationFrame section="proposals" crumbs={crumbs} title={title}>
      <PageBody>
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6">
          {!builder ? <EngineMissing /> : null}
          <QueryState
            query={proposal}
            skeleton={<Skeleton className="h-64 w-full" />}
            errorTitle={t('proposal.loadError')}
          >
            {(data: ProposalDetail) => (
              <ProposalBody detail={data} type={type} onTypeChange={onTypeChange} />
            )}
          </QueryState>
        </div>
      </PageBody>
    </AutomationFrame>
  )
}

interface ProposalBodyProps {
  detail: ProposalDetail
  type: MaturingType | null
  onTypeChange(type: MaturingType): void
}

function ProposalBody({ detail, type, onTypeChange }: ProposalBodyProps) {
  const { t } = useTranslation(['automation', 'cases'])
  const { proposal } = detail
  const stages = useAiStages()
  const served = typeStage(stages.data, type)
  const record = useProposalRecord(proposal.proposalId)
  const prod = useAlias(proposal.agentId, 'prod')
  const history = record.data?.history ?? []
  const publishedReleaseId = publishedReleaseOf(history)
  const servesThisAgent = served?.agent === 'active' && served.agentId === proposal.agentId
  const endStep: EndStep = endStepFor({
    typeAgent: served?.agent ?? null,
    servesThisAgent,
    inProduction: prod.data === undefined ? undefined : prod.data !== null,
    prodHoldsThisRelease:
      publishedReleaseId === null || prod.data === undefined
        ? null
        : prod.data?.releaseId === publishedReleaseId,
  })
  const done =
    proposal.state === 'published' &&
    (endStep === 'promote'
      ? publishedReleaseId !== null && prod.data?.releaseId === publishedReleaseId
      : servesThisAgent)
  const [gate, setGate] = useState<GateResult | null>(null)
  // The report of the current candidate, or the one a failed gate just returned.
  const report = gate?.report ?? detail.lastEval?.report ?? null
  return (
    <>
      <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-2 p-0 text-14 text-ink-2">
        <li className="inline-flex items-center gap-1.5">
          <AgentAvatar avatar={agentAvatarOf(stages.data, proposal.agentId)} size={22} />
          {t('proposal.agent', { agent: agentDisplayName(stages.data, proposal.agentId) })}
        </li>
        {type ? (
          <li className="inline-flex items-center gap-1.5">
            <Tag size={14} aria-hidden="true" />
            {t('proposal.forType', { type: typeName(type) })}
          </li>
        ) : null}
        <li>
          <Status {...proposalStatus(proposal.state)} />
        </li>
      </ul>
      {servesThisAgent && type ? (
        <AgentPhotoSlot type={type} avatar={agentAvatarOf(stages.data, proposal.agentId)} />
      ) : null}
      <Stepper state={proposal.state} done={done} endStep={endStep} />
      {record.data?.improvement ? (
        <ImprovementDossier improvement={record.data.improvement} />
      ) : announcedByEngine(history) ? (
        <Callout tone="neutral">{t('dossier.missing')}</Callout>
      ) : null}
      <ProposalNextStep
        detail={detail}
        type={type}
        onGateResult={setGate}
        onTypeChosen={onTypeChange}
        endStep={endStep}
        prod={prod.data}
        publishedReleaseId={publishedReleaseId}
      />
      {report ? <EvaluationReport report={report} failedNow={gate?.failed ?? false} /> : null}
      {record.isError ? (
        <Callout tone="warn">{t('history.loadError')}</Callout>
      ) : record.data ? (
        <ProposalHistory entries={history} />
      ) : null}
      <ReleaseValues changes={detail.review?.releaseChanges ?? []} />
      <Changes detail={detail} />
    </>
  )
}

function Stepper({ state, done, endStep }: { state: string; done: boolean; endStep: EndStep }) {
  const { t } = useTranslation('automation')
  return (
    <ol
      aria-label={t('proposal.progress')}
      className="m-0 grid list-none grid-cols-4 gap-1 rounded-12 border border-border bg-surface p-2"
    >
      {proposalSteps(state, done, endStep).map((step) => (
        <li
          key={step.key}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5 rounded-8 px-2 py-1.5 text-13',
            step.state === 'current' && 'bg-accent-soft font-semibold text-accent-strong',
            step.state === 'done' && 'text-ink',
            step.state === 'later' && 'text-muted',
          )}
        >
          {step.state === 'done' ? (
            <Check size={14} aria-hidden="true" className="shrink-0 text-success-ink" />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-full',
                step.state === 'current' ? 'bg-accent-strong' : 'bg-border',
              )}
            />
          )}
          <span className="min-w-0 truncate">{step.label}</span>
          {step.state === 'done' ? <span className="sr-only">{t('proposal.stepDone')}</span> : null}
        </li>
      ))}
    </ol>
  )
}

/** A setting value as the approver reads it (`null` is "no value"). */
function settingText(value: unknown, empty: string): string {
  if (value === null || value === undefined) return empty
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * The release settings the candidate takes (interrupts, language detection, injection rules, input
 * limit): each value before and after, and, when it comes from a donor release
 * (`release_settings.inherit_from`), which one ("heredado de <release>").
 */
function ReleaseValues({ changes }: { changes: ReleaseSettingChange[] }) {
  const { t } = useTranslation('automation')
  if (changes.length === 0) return null
  return (
    <section aria-labelledby="proposal-release-values" className="flex flex-col gap-3">
      <h2 id="proposal-release-values" className="m-0 text-15 font-semibold">
        {t('proposal.releaseValues')}
      </h2>
      <span className="text-12 text-muted">{t('proposal.releaseValuesNote')}</span>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {changes.map((change) => (
          <li
            key={change.field}
            className="flex flex-wrap items-center gap-2 rounded-12 border border-border bg-surface px-4 py-3"
          >
            <span className="font-mono text-13">{change.field}</span>
            <span className="text-13 text-ink-2">
              {settingText(change.before, t('proposal.noValue'))} {'→'}{' '}
              <span className="font-semibold text-ink">
                {settingText(change.after, t('proposal.noValue'))}
              </span>
            </span>
            {change.inherited ? (
              <Badge tone="neutral">
                {t('proposal.inheritedFrom', { release: change.inheritedFrom ?? '?' })}
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Changes({ detail }: { detail: ProposalDetail }) {
  const { t } = useTranslation('automation')
  const tools = draftTools(detail.changes, detail.proposal.agentId)
  const languages = draftLanguages(detail.changes, detail.proposal.agentId)
  return (
    <section aria-labelledby="proposal-changes" className="flex flex-col gap-3">
      <h2 id="proposal-changes" className="m-0 text-15 font-semibold">
        {t('proposal.changes')}
      </h2>
      {tools.length > 0 || languages.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-12 border border-border bg-surface px-4 py-3">
          {tools.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-13 font-semibold">{t('proposal.tools')}</span>
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {tools.map((tool) => (
                  <li key={tool}>
                    <Badge tone="neutral" icon={<Wrench size={12} aria-hidden="true" />}>
                      {toolName(tool)}
                    </Badge>
                  </li>
                ))}
              </ul>
              <span className="text-12 text-muted">{t('proposal.toolsNote')}</span>
            </div>
          ) : null}
          {languages.length > 0 ? (
            <div className="flex items-center gap-2 text-13">
              <span className="font-semibold">{t('proposal.languages')}</span>
              <LanguageMarks languages={languages} />
            </div>
          ) : null}
        </div>
      ) : null}
      {detail.changes.length === 0 ? (
        <EmptyState as="h3" size="compact" title={t('proposal.changesEmpty')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {detail.changes.map((change, index) => {
            const view = changeView(change, index)
            return (
              <li
                key={view.key}
                className="flex flex-col gap-1.5 rounded-12 border border-border bg-surface px-4 py-3"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{view.kind}</Badge>
                  {view.id ? <span className="font-mono text-13">{view.id}</span> : null}
                  {view.version ? <span className="text-12 text-muted">{view.version}</span> : null}
                </span>
                <span className="text-14 whitespace-pre-line">{view.description}</span>
                {view.rationale ? (
                  <span className="text-13 text-ink-2">
                    <span className="font-semibold">{t('proposal.why')}: </span>
                    {view.rationale}
                  </span>
                ) : null}
                {view.changelog ? (
                  <span className="text-13 text-ink-2">
                    <span className="font-semibold">{t('proposal.changelog')}: </span>
                    {view.changelog}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
