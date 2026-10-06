import { useNavigate } from 'react-router'
import { Bot } from 'lucide-react'
import { automationAgentPath } from '@/app/paths'
import { PageBody } from '@/components/layout'
import {
  EmptyState,
  Skeleton,
  SourceNote,
  Status,
  TBody,
  TCell,
  TH,
  THead,
  TRow,
  TRowSelect,
  Table,
} from '@/components/ui'
import { useAiStages } from '@/features/copilot/core'
import { formatList } from '@/lib/format'
import { useTranslation } from '@/lib/i18n'
import { agentIds, agentRow, agentRunAppearance, type AgentRow } from '../agents'
import {
  useAgentsAliases,
  useBuilderAvailable,
  useProposals,
  useReleases,
} from '../hooks/use-automation'
import { agentAvatarOf, agentName, typeName } from '../model'
import { AgentAvatar } from './AgentAvatar'
import { AutomationFrame, EngineMissing } from './AutomationFrame'

/**
 * "Agentes" (IaAutomatizacion `agentes`): the agents that serve a case type and the ones proposals
 * are for, where each runs (`prod`, only `staging`, nowhere) and its version. The canvas's "Hoy"
 * column (chats resolved and handed over) is not shown: see slice-22-automation.md §6.
 */
export function AgentsScreen() {
  const { t } = useTranslation(['automation', 'cases'])
  const navigate = useNavigate()
  const builder = useBuilderAvailable()
  const stages = useAiStages()
  const proposals = useProposals({ enabled: builder })
  const ids = agentIds(stages.data, proposals.data?.items ?? [])
  const aliases = useAgentsAliases(ids, builder)
  const releaseIds = aliases
    .map((entry) => (entry.prod ?? entry.staging)?.releaseId)
    .filter((id): id is string => typeof id === 'string')
  const releases = useReleases(releaseIds)
  // While the registry answers, the status cell waits instead of saying "Sin datos del registro".
  const pendingIds = new Set(aliases.filter((entry) => entry.pending).map((entry) => entry.agentId))
  const rows: AgentRow[] = aliases.map((entry) =>
    agentRow(
      entry.agentId,
      stages.data,
      builder
        ? { prod: entry.prod, staging: entry.staging }
        : { prod: undefined, staging: undefined },
      releases,
    ),
  )
  const loading = stages.isPending
  return (
    <AutomationFrame
      section="agents"
      title={t('agents.heading')}
      subtitle={t('agents.intro')}
      documentTitle={t('agents.heading')}
    >
      <PageBody>
        <div className="flex flex-col gap-4">
          {!builder ? <EngineMissing /> : null}
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Bot size={28} aria-hidden="true" />}
              title={t('agents.empty')}
              description={t('agents.emptyText')}
            />
          ) : (
            <div className="overflow-hidden rounded-12 border border-border bg-surface">
              <Table aria-label={t('agents.table')} density="comfortable">
                <THead>
                  <tr>
                    <TH>{t('agents.columns.agent')}</TH>
                    <TH>{t('agents.columns.serves')}</TH>
                    <TH>{t('agents.columns.status')}</TH>
                    <TH>{t('agents.columns.version')}</TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TRow
                      key={row.agentId}
                      onSelect={() => void navigate(automationAgentPath(row.agentId))}
                    >
                      <TCell>
                        <TRowSelect>
                          <span className="inline-flex items-center gap-2">
                            <AgentAvatar
                              avatar={agentAvatarOf(stages.data, row.agentId)}
                              size={28}
                            />
                            <span className="flex flex-col">
                              <span className="font-semibold">{agentName(row.agentId)}</span>
                              <span className="font-mono text-12 text-muted">{row.agentId}</span>
                            </span>
                          </span>
                        </TRowSelect>
                      </TCell>
                      <TCell muted={row.serves.length === 0}>
                        {row.serves.length > 0
                          ? formatList(row.serves.map(typeName))
                          : t('agents.servesNone')}
                      </TCell>
                      <TCell>
                        {pendingIds.has(row.agentId) ? (
                          <Skeleton className="h-4 w-28" />
                        ) : (
                          <Status {...agentRunAppearance(row.status)} />
                        )}
                      </TCell>
                      <TCell className="font-mono text-13">{row.version ?? ''}</TCell>
                    </TRow>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
          <SourceNote variant="inline">{t('agents.footnote')}</SourceNote>
        </div>
      </PageBody>
    </AutomationFrame>
  )
}
