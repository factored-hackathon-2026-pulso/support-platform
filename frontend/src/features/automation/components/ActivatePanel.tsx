import { useState } from 'react'
import { Bot, CircleCheck, Tag } from 'lucide-react'
import { automationAgentPath, automationTypePath } from '@/app/paths'
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Field,
  LanguageMarks,
  LinkButton,
  Select,
  Skeleton,
} from '@/components/ui'
import { useAiStages } from '@/features/copilot/core'
import { useTranslation } from '@/lib/i18n'
import { useActivateAgent, useAlias, useRelease } from '../hooks/use-automation'
import { agentDisplayName, agentName, isMaturing, readyTypes, typeName, typeStage } from '../model'
import { describeBuilderFailure, draftLanguages, reportView } from '../proposals'
import type { MaturingType, ProposalDetail } from '../types'
import { StepUpDialog } from './StepUpDialog'

export interface ActivatePanelProps {
  detail: ProposalDetail
  /** The case type the proposal is for, when the URL names it. */
  type: MaturingType | null
  onTypeChosen(type: MaturingType): void
}

/**
 * "Activar" (IaAutomatizacion `activar` and `activado`): a published proposal's release goes to
 * `prod` and the case type records that its agent serves it, with her authenticator code. Once the
 * agent serves the type, the done view.
 */
export function ActivatePanel({ detail, type, onTypeChosen }: ActivatePanelProps) {
  const { t } = useTranslation(['automation', 'cases'])
  const { proposal } = detail
  const stages = useAiStages()
  const entry = typeStage(stages.data, type)
  const staging = useAlias(proposal.agentId, 'staging')
  const release = useRelease(staging.data?.releaseId ?? null)
  const published =
    release.data && release.data.proposalId === proposal.proposalId ? release.data : null
  const [reviewed, setReviewed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activate = useActivateAgent(type)

  if (type && entry?.agent === 'active' && entry.agentId === proposal.agentId) {
    return <Activated agentId={proposal.agentId} type={type} />
  }

  const report = detail.lastEval ? reportView(detail.lastEval.report) : null
  const languages = draftLanguages(detail.changes, proposal.agentId)
  const ready = readyTypes(stages.data)
    .map((candidate) => candidate.caseType)
    .filter(isMaturing)
  const loadingRelease = staging.isPending || (staging.data && release.isPending)
  const canActivate = type !== null && entry?.agent === 'ready' && published !== null

  function confirm(code: string) {
    if (!published || !type) return
    setError(null)
    activate.mutate(
      { agentId: proposal.agentId, releaseId: published.releaseId, stepUpCode: code },
      {
        onSuccess: () => setConfirming(false),
        onError: (failure) => {
          const described = describeBuilderFailure(failure)
          setError('message' in described ? described.message : t('activate.failed'))
        },
      },
    )
  }

  return (
    <Card
      as="section"
      padding="md"
      aria-labelledby="activate-title"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="activate-title" className="m-0 text-17 font-semibold">
          {t('activate.title', { agent: agentDisplayName(stages.data, proposal.agentId) })}
        </h2>
        <p className="m-0 text-14 text-ink-2">{t('activate.intro')}</p>
      </div>
      {type === null ? (
        ready.length > 0 ? (
          <Field label={t('activate.typeLabel')}>
            <Select
              placeholder={t('activate.typePlaceholder')}
              value=""
              options={ready.map((value) => ({ value, label: typeName(value) }))}
              onChange={(event) => {
                const chosen = ready.find((value) => value === event.target.value)
                if (chosen) onTypeChosen(chosen)
              }}
            />
          </Field>
        ) : (
          <p className="m-0 text-14 text-ink-2">{t('activate.noReadyType')}</p>
        )
      ) : null}
      <dl className="m-0 grid grid-cols-[180px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-14">
        {type ? (
          <>
            <dt className="text-ink-2">{t('activate.serves')}</dt>
            <dd className="m-0 inline-flex items-center gap-1.5 font-medium">
              <Tag size={14} aria-hidden="true" />
              {typeName(type)}
            </dd>
          </>
        ) : null}
        {languages.length > 0 ? (
          <>
            <dt className="text-ink-2">{t('activate.languages')}</dt>
            <dd className="m-0">
              <LanguageMarks languages={languages} />
            </dd>
          </>
        ) : null}
        <dt className="text-ink-2">{t('activate.starts')}</dt>
        <dd className="m-0">{t('activate.startsValue')}</dd>
        <dt className="text-ink-2">{t('activate.handoff')}</dt>
        <dd className="m-0">{t('activate.handoffValue')}</dd>
        {report ? (
          <>
            <dt className="text-ink-2">{t('activate.test')}</dt>
            <dd className="m-0">
              {t('activate.testValue', { passed: report.passedCount, total: report.total })}
            </dd>
          </>
        ) : null}
        <dt className="text-ink-2">{t('activate.release')}</dt>
        <dd className="m-0 font-mono text-13">
          {loadingRelease ? <Skeleton className="h-4 w-40" /> : (published?.releaseId ?? '')}
        </dd>
      </dl>
      {!loadingRelease && published === null ? (
        <Callout tone="warn">{t('activate.releaseMissing')}</Callout>
      ) : null}
      {type && entry && entry.agent !== 'ready' ? (
        <Callout tone="warn">{t('activate.notReady')}</Callout>
      ) : null}
      <Checkbox
        label={t('activate.reviewed')}
        checked={reviewed}
        onChange={(event) => setReviewed(event.target.checked)}
      />
      <div className="flex justify-end">
        <Button
          variant="primary"
          icon={<Bot size={16} />}
          aria-disabled={!reviewed || !canActivate}
          onClick={() => {
            if (reviewed && canActivate) setConfirming(true)
          }}
        >
          {t('activate.submit')}
        </Button>
      </div>
      {confirming ? (
        <StepUpDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(false)
          }}
          title={t('activate.title', { agent: agentDisplayName(stages.data, proposal.agentId) })}
          description={type ? typeName(type) : undefined}
          confirmLabel={t('activate.submit')}
          pending={activate.isPending}
          error={error}
          onConfirm={confirm}
        />
      ) : null}
    </Card>
  )
}

function Activated({ agentId, type }: { agentId: string; type: MaturingType }) {
  const { t } = useTranslation(['automation', 'cases'])
  return (
    <Card
      as="section"
      padding="lg"
      aria-labelledby="activated-title"
      className="flex flex-col items-start gap-3"
    >
      <CircleCheck size={28} aria-hidden="true" className="text-success-ink" />
      <h2 id="activated-title" className="m-0 font-display text-22 font-semibold">
        {t('activate.doneTitle', { agent: agentName(agentId), type: typeName(type) })}
      </h2>
      <p className="m-0 max-w-[640px] text-14 text-ink-2">{t('activate.doneText')}</p>
      <div className="flex flex-wrap gap-2">
        <LinkButton to={automationTypePath()} variant="secondary">
          {t('activate.backToTypes')}
        </LinkButton>
        <LinkButton to={automationAgentPath(agentId)} variant="primary">
          {t('activate.seeAgent')}
        </LinkButton>
      </div>
    </Card>
  )
}
