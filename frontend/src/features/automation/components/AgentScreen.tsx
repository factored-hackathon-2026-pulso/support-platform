import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Tag } from 'lucide-react'
import { automationProposalPath, automationTypePath, PATHS } from '@/app/paths'
import { PageBody } from '@/components/layout'
import { Button, Card, QueryState, Skeleton, Status, useToast } from '@/components/ui'
import { useAiStages } from '@/features/copilot/core'
import { formatDate } from '@/lib/format'
import { useTranslation } from '@/lib/i18n'
import {
  agentRunAppearance,
  agentRunStatus,
  newestFirst,
  promotionTarget,
  rollbackTarget,
  servedTypes,
} from '../agents'
import {
  useAgentVersions,
  useAlias,
  useBuilderAvailable,
  usePromoteProd,
  useProposals,
  useRelease,
} from '../hooks/use-automation'
import { agentAvatarOf, agentName, servedTypeOf, typeName } from '../model'
import { AgentAvatar } from './AgentAvatar'
import { AgentPhotoSlot } from './AgentPhotoSlot'
import { agentVersionIn, describeBuilderFailure, proposalStatus } from '../proposals'
import type { AliasState, VersionList } from '../types'
import { AutomationFrame, EngineMissing } from './AutomationFrame'
import { StepUpDialog } from './StepUpDialog'

export interface AgentScreenProps {
  agentId: string
}

/**
 * One agent (IaAutomatizacion `agente`): where it runs, the case types it serves, its versions and
 * its proposals. "Pasar a producción" and "Volver a la versión anterior" are the registry's alias
 * promotion (her code). There is no "Pausar": the registry has nothing that stops an agent (a
 * release can only be revoked by Administración once `prod` no longer points at it).
 */
export function AgentScreen({ agentId }: AgentScreenProps) {
  const { t } = useTranslation(['automation', 'cases'])
  const builder = useBuilderAvailable()
  const stages = useAiStages()
  const serves = servedTypes(stages.data, agentId)
  const prod = useAlias(builder ? agentId : null, 'prod')
  const staging = useAlias(builder ? agentId : null, 'staging')
  const status = builder ? agentRunStatus(prod.data, staging.data) : 'unknown'
  const name = agentName(agentId)
  const avatar = agentAvatarOf(stages.data, agentId)
  const servedType = servedTypeOf(stages.data, agentId)
  return (
    <AutomationFrame
      section="agents"
      crumbs={[
        { label: t('title'), to: PATHS.supervision.automation },
        { label: t('agents.heading'), to: PATHS.supervision.automationAgents },
        { label: name },
      ]}
      title={
        <span className="inline-flex items-center gap-3">
          <AgentAvatar avatar={avatar} size={32} />
          {name}
        </span>
      }
      subtitle={<span className="font-mono text-13">{agentId}</span>}
      documentTitle={name}
    >
      <PageBody>
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-5">
          {servedType ? <AgentPhotoSlot agentId={agentId} /> : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Status {...agentRunAppearance(status)} />
            {serves.map((type) => (
              <span key={type} className="inline-flex items-center gap-1.5 text-14">
                <Tag size={14} aria-hidden="true" />
                {typeName(type)}
              </span>
            ))}
          </div>
          {builder ? (
            <WhereItRuns agentId={agentId} prod={prod.data} staging={staging.data} />
          ) : (
            <EngineMissing />
          )}
          <Section title={t('agent.serves')}>
            {serves.length === 0 ? (
              <p className="m-0 text-14 text-ink-2">{t('agent.servesNone')}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {serves.map((type) => (
                  <li key={type}>
                    <Link to={automationTypePath(type)} className="text-14 text-link">
                      {typeName(type)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {builder ? <Versions agentId={agentId} /> : null}
          {builder ? <AgentProposals agentId={agentId} /> : null}
        </div>
      </PageBody>
    </AutomationFrame>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="section" padding="md" className="flex flex-col gap-3">
      <h2 className="m-0 text-15 font-semibold">{title}</h2>
      {children}
    </Card>
  )
}

interface WhereItRunsProps {
  agentId: string
  prod: AliasState | null | undefined
  staging: AliasState | null | undefined
}

function WhereItRuns({ agentId, prod, staging }: WhereItRunsProps) {
  const { t } = useTranslation('automation')
  const prodRelease = useRelease(prod?.releaseId ?? null)
  const stagingRelease = useRelease(staging?.releaseId ?? null)
  const previous = rollbackTarget(prodRelease.data)
  const next = promotionTarget(prod, staging)
  const [moving, setMoving] = useState<'rollback' | 'promote' | null>(null)
  return (
    <Section title={t('agent.where')}>
      <dl className="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-14">
        <dt className="text-ink-2">{t('agent.prod')}</dt>
        <dd className="m-0">
          <ReleaseLine alias={prod} release={prodRelease.data} />
        </dd>
        <dt className="text-ink-2">{t('agent.staging')}</dt>
        <dd className="m-0">
          <ReleaseLine alias={staging} release={stagingRelease.data} />
        </dd>
      </dl>
      {next || previous ? (
        <div className="flex flex-wrap justify-end gap-2">
          {previous ? (
            <Button variant="secondary" size="sm" onClick={() => setMoving('rollback')}>
              {t('agent.rollback')}
            </Button>
          ) : null}
          {next ? (
            <Button variant="primary" size="sm" onClick={() => setMoving('promote')}>
              {t('agent.promote')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {moving ? (
        <PromoteDialog
          agentId={agentId}
          kind={moving}
          releaseId={(moving === 'rollback' ? previous : next) ?? ''}
          onClose={() => setMoving(null)}
        />
      ) : null}
    </Section>
  )
}

function ReleaseLine({
  alias,
  release,
}: {
  alias: AliasState | null | undefined
  release: Parameters<typeof agentVersionIn>[0]
}) {
  const { t } = useTranslation('automation')
  if (alias === undefined) return <Skeleton className="h-4 w-48" />
  if (alias === null) return <span className="text-ink-2">{t('agent.nowhere')}</span>
  const version = agentVersionIn(release)
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {version ? <span className="font-medium">{t('agent.version', { version })}</span> : null}
      <span className="font-mono text-12 text-muted">{alias.releaseId}</span>
      {release ? (
        <span className="text-13 text-ink-2">
          {t('agent.published', { date: formatDate(release.publishedAt) })}
        </span>
      ) : null}
    </span>
  )
}

function PromoteDialog({
  agentId,
  kind,
  releaseId,
  onClose,
}: {
  agentId: string
  kind: 'rollback' | 'promote'
  releaseId: string
  onClose(): void
}) {
  const { t } = useTranslation('automation')
  const promote = usePromoteProd(agentId)
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const name = agentName(agentId)
  return (
    <StepUpDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={
        kind === 'rollback'
          ? t('agent.rollbackTitle', { agent: name })
          : t('agent.promoteTitle', { agent: name })
      }
      description={kind === 'rollback' ? t('agent.rollbackText') : t('agent.promoteText')}
      confirmLabel={kind === 'rollback' ? t('agent.rollback') : t('agent.promote')}
      pending={promote.isPending}
      error={error}
      onConfirm={(code) => {
        setError(null)
        promote.mutate(
          { releaseId, stepUpCode: code },
          {
            onSuccess: () => {
              toast({
                title: kind === 'rollback' ? t('agent.rollbackDone') : t('agent.promoteDone'),
              })
              onClose()
            },
            onError: (failure) => {
              const described = describeBuilderFailure(failure)
              setError('message' in described ? described.message : t('failure.generic'))
            },
          },
        )
      }}
    />
  )
}

function Versions({ agentId }: { agentId: string }) {
  const { t } = useTranslation('automation')
  const versions = useAgentVersions(agentId)
  return (
    <Section title={t('agent.versions')}>
      <QueryState
        query={versions}
        skeleton={<Skeleton className="h-16 w-full" />}
        errorTitle={t('agent.loadError')}
      >
        {(data: VersionList) =>
          data.items.length === 0 ? (
            <p className="m-0 text-14 text-ink-2">{t('agent.versionsEmpty')}</p>
          ) : (
            <ol className="m-0 flex list-none flex-col divide-y divide-border-soft p-0">
              {newestFirst(data.items).map((item) => (
                <li
                  key={item.ref.version}
                  className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-baseline gap-3 py-2"
                >
                  <span className="font-mono text-13 font-medium">{item.ref.version}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-14">{item.docs.changelog || item.docs.description}</span>
                    {item.docs.changelog && item.docs.description ? (
                      <span className="text-13 text-ink-2">{item.docs.description}</span>
                    ) : null}
                  </span>
                  <span className="text-13 whitespace-nowrap text-muted">
                    {formatDate(item.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )
        }
      </QueryState>
    </Section>
  )
}

function AgentProposals({ agentId }: { agentId: string }) {
  const { t } = useTranslation('automation')
  const proposals = useProposals()
  const mine = (proposals.data?.items ?? []).filter((p) => p.agentId === agentId)
  return (
    <Section title={t('agent.proposals')}>
      {proposals.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : mine.length === 0 ? (
        <p className="m-0 text-14 text-ink-2">{t('agent.proposalsEmpty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {mine.map((proposal) => (
            <li key={proposal.proposalId}>
              <Link
                to={automationProposalPath(proposal.proposalId)}
                className="flex items-center justify-between gap-3 rounded-8 px-2 py-1.5 text-14 hover:bg-subtle"
              >
                <span className="min-w-0 truncate">{proposal.title}</span>
                <Status {...proposalStatus(proposal.state)} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
