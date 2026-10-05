import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { FileText, Sparkles } from 'lucide-react'
import { automationProposalPath } from '@/app/paths'
import { PageBody } from '@/components/layout'
import {
  Button,
  EmptyState,
  Field,
  Input,
  QueryState,
  Skeleton,
  Status,
  TBody,
  TCell,
  TH,
  THead,
  TRow,
  TRowSelect,
  Table,
  Tooltip,
  useToast,
} from '@/components/ui'
import { formatRelativeTime } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { isApiProblem } from '@/lib/api'
import { useTranslation } from '@/lib/i18n'
import { useBuilderAvailable, useProposals, useTrackProposal } from '../hooks/use-automation'
import { agentName } from '../model'
import { describeBuilderFailure, proposalSource, proposalStatus } from '../proposals'
import type { ProposalList } from '../types'
import { AutomationFrame, EngineMissing } from './AutomationFrame'

const TICK_MS = 60_000

/**
 * "Propuestas" (slice 16 §6 on IaAutomatizacion's frame): every proposal the platform knows (made
 * here, by the builder chat, tracked by id and, once the improvement engine announces them, by the
 * engine), its state and where it came from; "Seguir" brings one in by id.
 */
export function ProposalsScreen() {
  const { t } = useTranslation('automation')
  const builder = useBuilderAvailable()
  const proposals = useProposals({ enabled: builder })
  return (
    <AutomationFrame
      section="proposals"
      title={t('proposals.heading')}
      subtitle={t('proposals.intro')}
      documentTitle={t('proposals.heading')}
    >
      <PageBody>
        <div className="flex flex-col gap-4">
          {builder ? (
            <>
              <TrackForm />
              <QueryState
                query={proposals}
                skeleton={<Skeleton className="h-40 w-full" />}
                errorTitle={t('proposals.loadError')}
              >
                {(data: ProposalList) => <ProposalTable data={data} />}
              </QueryState>
            </>
          ) : (
            <EngineMissing />
          )}
        </div>
      </PageBody>
    </AutomationFrame>
  )
}

function ProposalTable({ data }: { data: ProposalList }) {
  const { t } = useTranslation('automation')
  const navigate = useNavigate()
  const now = useNow(TICK_MS)
  if (data.items.length === 0) {
    return (
      <EmptyState
        icon={<FileText size={28} aria-hidden="true" />}
        title={t('proposals.empty')}
        description={t('proposals.emptyText')}
      />
    )
  }
  return (
    <div className="overflow-hidden rounded-12 border border-border bg-surface">
      <Table aria-label={t('proposals.table')}>
        <THead>
          <tr>
            <TH>{t('proposals.columns.proposal')}</TH>
            <TH>{t('proposals.columns.agent')}</TH>
            <TH>{t('proposals.columns.state')}</TH>
            <TH>{t('proposals.columns.source')}</TH>
            <TH>{t('proposals.columns.updated')}</TH>
          </tr>
        </THead>
        <TBody>
          {data.items.map((proposal) => {
            const source = proposalSource(proposal.source)
            return (
              <TRow
                key={proposal.proposalId}
                onSelect={() => void navigate(automationProposalPath(proposal.proposalId))}
              >
                <TCell>
                  <TRowSelect>
                    <span className="font-medium">{proposal.title}</span>
                  </TRowSelect>
                </TCell>
                <TCell>{agentName(proposal.agentId)}</TCell>
                <TCell>
                  <span className="inline-flex items-center gap-2">
                    <Status {...proposalStatus(proposal.state)} />
                    {!proposal.live ? (
                      <Tooltip content={t('proposals.notLiveTooltip')}>
                        <span className="text-12 text-muted">{t('proposals.notLive')}</span>
                      </Tooltip>
                    ) : null}
                  </span>
                </TCell>
                <TCell muted>
                  <span className="inline-flex items-center gap-1.5">
                    {source.engine ? <Sparkles size={13} aria-hidden="true" /> : null}
                    {source.label}
                  </span>
                </TCell>
                <TCell muted>{formatRelativeTime(proposal.updatedAt, now)}</TCell>
              </TRow>
            )
          })}
        </TBody>
      </Table>
    </div>
  )
}

function TrackForm() {
  const { t } = useTranslation('automation')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const track = useTrackProposal()
  const { toast } = useToast()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const proposalId = value.trim()
    if (!proposalId) return
    setError(null)
    track.mutate(proposalId, {
      onSuccess: () => {
        setValue('')
        toast({ title: t('proposals.track.done') })
      },
      onError: (failure) => {
        if (isApiProblem(failure, 'registry_not_found')) setError(t('proposals.track.notFound'))
        else {
          const described = describeBuilderFailure(failure)
          setError('message' in described ? described.message : t('failure.generic'))
        }
      },
    })
  }
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <Field
        label={t('proposals.track.label')}
        hint={t('proposals.track.hint')}
        error={error ?? undefined}
        className="max-w-[420px] grow"
      >
        <Input
          value={value}
          size="sm"
          className="font-mono"
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
        />
      </Field>
      <Button type="submit" variant="secondary" size="sm" loading={track.isPending}>
        {t('proposals.track.submit')}
      </Button>
    </form>
  )
}
