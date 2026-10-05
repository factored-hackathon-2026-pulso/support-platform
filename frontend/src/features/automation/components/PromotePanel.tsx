import { useState } from 'react'
import { CircleCheck, Rocket } from 'lucide-react'
import { automationAgentPath } from '@/app/paths'
import { Button, Callout, Card, Checkbox, LinkButton, Skeleton, useToast } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
import { useAlias, usePromoteProd, useRelease } from '../hooks/use-automation'
import { useAiStages } from '@/features/copilot/core'
import { agentDisplayName } from '../model'
import { describeBuilderFailure, reportView } from '../proposals'
import type { AliasState, ProposalDetail } from '../types'
import { StepUpDialog } from './StepUpDialog'

export interface PromotePanelProps {
  detail: ProposalDetail
  /** The agent's `prod` alias now (null: it points nowhere). */
  prod: AliasState | null
  /** The release this proposal published, from its history (null when not recorded here). */
  publishedReleaseId: string | null
}

/**
 * "Pasar a producción" for a published proposal of an agent that already runs in production (the
 * improvement engine's proposals patch such agents; "Activar" is only the first agent of a case
 * type). Publishing left the release in `staging`; this moves `prod` to it with her
 * authenticator code. Once `prod` points at it, the done view.
 */
export function PromotePanel({ detail, prod, publishedReleaseId }: PromotePanelProps) {
  const { t } = useTranslation('automation')
  const { proposal } = detail
  const stages = useAiStages()
  const agent = agentDisplayName(stages.data, proposal.agentId)
  // Without a recorded publication, the release `staging` points at, if it is this proposal's.
  const staging = useAlias(publishedReleaseId ? null : proposal.agentId, 'staging')
  const stagingRelease = useRelease(staging.data?.releaseId ?? null)
  const releaseId =
    publishedReleaseId ??
    (stagingRelease.data?.proposalId === proposal.proposalId ? stagingRelease.data.releaseId : null)
  const loading =
    publishedReleaseId === null && (staging.isPending || (staging.data && stagingRelease.isPending))
  const [reviewed, setReviewed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const promote = usePromoteProd(proposal.agentId, proposal.proposalId)
  const { toast } = useToast()

  if (releaseId !== null && prod?.releaseId === releaseId) {
    return (
      <Card
        as="section"
        padding="lg"
        aria-labelledby="promoted-title"
        className="flex flex-col items-start gap-3"
      >
        <CircleCheck size={28} aria-hidden="true" className="text-success-ink" />
        <h2 id="promoted-title" className="m-0 font-display text-22 font-semibold">
          {t('promote.done')}
        </h2>
        <p className="m-0 max-w-[640px] text-14 text-ink-2">{t('promote.doneText', { agent })}</p>
        <LinkButton to={automationAgentPath(proposal.agentId)} variant="secondary">
          {t('promote.seeAgent')}
        </LinkButton>
      </Card>
    )
  }

  const report = detail.lastEval ? reportView(detail.lastEval.report) : null
  const canPromote = releaseId !== null

  function confirm(code: string) {
    if (releaseId === null) return
    setError(null)
    promote.mutate(
      { releaseId, stepUpCode: code },
      {
        onSuccess: () => {
          setConfirming(false)
          toast({ title: t('promote.done') })
        },
        onError: (failure) => {
          const described = describeBuilderFailure(failure)
          setError('message' in described ? described.message : t('promote.failed'))
        },
      },
    )
  }

  return (
    <Card as="section" padding="md" aria-labelledby="promote-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="promote-title" className="m-0 text-17 font-semibold">
          {t('promote.title')}
        </h2>
        <p className="m-0 text-14 text-ink-2">{t('promote.intro', { agent })}</p>
      </div>
      <dl className="m-0 grid grid-cols-[180px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-14">
        <dt className="text-ink-2">{t('promote.prodNow')}</dt>
        <dd className="m-0 font-mono text-13">{prod?.releaseId ?? ''}</dd>
        <dt className="text-ink-2">{t('promote.thisRelease')}</dt>
        <dd className="m-0 font-mono text-13">
          {loading ? <Skeleton className="h-4 w-40" /> : (releaseId ?? '')}
        </dd>
        {report ? (
          <>
            <dt className="text-ink-2">{t('promote.test')}</dt>
            <dd className="m-0">
              {t('promote.testValue', { passed: report.passedCount, total: report.total })}
            </dd>
          </>
        ) : null}
      </dl>
      {!loading && releaseId === null ? (
        <Callout tone="warn">{t('promote.releaseMissing')}</Callout>
      ) : null}
      <Checkbox
        label={t('promote.reviewed')}
        checked={reviewed}
        onChange={(event) => setReviewed(event.target.checked)}
      />
      <div className="flex justify-end">
        <Button
          variant="primary"
          icon={<Rocket size={16} />}
          aria-disabled={!reviewed || !canPromote}
          onClick={() => {
            if (reviewed && canPromote) setConfirming(true)
          }}
        >
          {t('promote.submit')}
        </Button>
      </div>
      {confirming ? (
        <StepUpDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(false)
          }}
          title={t('promote.dialogTitle')}
          description={agent}
          confirmLabel={t('promote.submit')}
          pending={promote.isPending}
          error={error}
          onConfirm={confirm}
        />
      ) : null}
    </Card>
  )
}
