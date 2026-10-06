import { Bot, Tag } from 'lucide-react'
import { AgentAvatar } from './AgentAvatar'
import { PageBody } from '@/components/layout'
import {
  Button,
  Callout,
  QueryState,
  Skeleton,
  SourceNote,
  TBody,
  TCell,
  TH,
  THead,
  TRow,
  TRowSelect,
  Table,
} from '@/components/ui'
import { useAiStages } from '@/features/copilot/core'
import { cn } from '@/lib/cn'
import { formatNumber } from '@/lib/format'
import { useTranslation } from '@/lib/i18n'
import {
  isMaturing,
  panoramaTypes,
  readyTypes,
  signalLine,
  stageLegend,
  stageView,
  typeCategory,
  typeName,
  typeStage,
} from '../model'
import type { AiStages, CaseTypeStage, MaturingType } from '../types'
import type { AutomationUrlState } from '../url'
import { AutomationFrame } from './AutomationFrame'
import { StageBars } from './StageBars'
import { TypePanel } from './TypePanel'

export interface TypesScreenProps {
  state: AutomationUrlState
  /** Open a type in the side panel (`?type=`), or close it. */
  onSelectType(type: MaturingType | null): void
}

/**
 * "Automatización" (IaAutomatizacion `panorama` and `tipo`, slice 22): every case type with its
 * stage, the signal it is measured by now and the cases closed in the stage; a type the system
 * proposes an agent for on top. Live: `ai.stage_updated` on `ai:stages`. A type opens in the side
 * panel: how it matured, the team rule against today's signals, moving it back and its agent.
 */
export function TypesScreen({ state, onSelectType }: TypesScreenProps) {
  const { t } = useTranslation(['automation', 'cases'])
  const stages = useAiStages()
  const selected = typeStage(stages.data, state.type)
  return (
    <AutomationFrame section="types" title={t('title')} subtitle={t('intro')}>
      <PageBody
        scroll={false}
        className={cn(
          'grid grid-rows-[minmax(0,1fr)] gap-4',
          selected ? 'grid-cols-[minmax(0,1fr)_420px]' : 'grid-cols-1',
        )}
      >
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <QueryState
            query={stages}
            skeleton={<Skeleton className="h-64 w-full" />}
            errorTitle={t('panorama.loadError')}
          >
            {(data: AiStages) => (
              <Panorama
                stages={data}
                selected={selected?.caseType ?? null}
                onSelect={(type) => onSelectType(type)}
              />
            )}
          </QueryState>
        </div>
        {selected && stages.data && isMaturing(selected.caseType) ? (
          <TypePanel
            key={selected.caseType}
            type={selected.caseType}
            entry={selected}
            rule={stages.data.rule}
            onClose={() => onSelectType(null)}
          />
        ) : null}
      </PageBody>
    </AutomationFrame>
  )
}

interface PanoramaProps {
  stages: AiStages
  selected: string | null
  onSelect(type: MaturingType): void
}

function Panorama({ stages, selected, onSelect }: PanoramaProps) {
  const { t } = useTranslation(['automation', 'cases'])
  const rows = panoramaTypes(stages)
  return (
    <>
      {readyTypes(stages)
        .filter((entry) => isMaturing(entry.caseType))
        .map((entry) => (
          <ReadyBanner key={entry.caseType} entry={entry} onOpen={onSelect} />
        ))}
      <section aria-labelledby="automation-types" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="automation-types" className="m-0 font-display text-17 font-semibold">
            {t('panorama.heading')}
          </h2>
          <ul
            aria-label={t('stage.legend.label')}
            className="m-0 flex list-none flex-wrap items-center gap-3 p-0 text-12 text-ink-2"
          >
            {stageLegend().map((item) => (
              <li key={item.key} className="inline-flex items-center gap-1.5">
                <StageBars bars={item.bars} agent={item.key === 'agent'} />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="overflow-x-auto rounded-12 border border-border bg-surface">
          <Table aria-label={t('panorama.table')} density="comfortable">
            <THead>
              <tr>
                <TH>{t('panorama.columns.type')}</TH>
                <TH>{t('panorama.columns.stage')}</TH>
                <TH>{t('panorama.columns.signal')}</TH>
                <TH align="right">{t('panorama.columns.closed')}</TH>
                <TH>
                  <span className="sr-only">{t('panorama.columns.action')}</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((entry) =>
                isMaturing(entry.caseType) ? (
                  <TypeRow
                    key={entry.caseType}
                    type={entry.caseType}
                    entry={entry}
                    signal={signalLine(entry, stages.rule)}
                    selected={entry.caseType === selected}
                    onSelect={onSelect}
                  />
                ) : null,
              )}
            </TBody>
          </Table>
        </div>
      </section>
      <SourceNote variant="inline">{t('panorama.footnote')}</SourceNote>
    </>
  )
}

interface TypeRowProps {
  type: MaturingType
  entry: CaseTypeStage
  signal: string
  selected: boolean
  onSelect(type: MaturingType): void
}

function TypeRow({ type, entry, signal, selected, onSelect }: TypeRowProps) {
  const { t } = useTranslation(['automation', 'cases'])
  const view = stageView(entry)
  return (
    <TRow selected={selected} onSelect={() => onSelect(type)}>
      <TCell>
        <TRowSelect aria-current={selected ? 'true' : undefined}>
          <span className="flex flex-col">
            <span className="inline-flex items-center gap-1.5 font-semibold whitespace-nowrap text-ink">
              <Tag size={13} aria-hidden="true" className="shrink-0" />
              {typeName(type)}
            </span>
            <span className="text-12 text-muted">{typeCategory(type)}</span>
          </span>
        </TRowSelect>
      </TCell>
      <TCell>
        <span className="inline-flex items-center gap-2 whitespace-nowrap" title={view.tip}>
          <StageBars bars={view.bars} agent={view.agent} />
          {entry.agent === 'active' && entry.agentAvatar ? (
            <AgentAvatar avatar={entry.agentAvatar} size={20} />
          ) : null}
          <span>{view.label}</span>
          <span className="sr-only">{view.tip}</span>
        </span>
      </TCell>
      <TCell muted>{signal}</TCell>
      <TCell align="right" numeric>
        {formatNumber(entry.signals.closedCases)}
      </TCell>
      <TCell align="right">
        <span
          aria-hidden="true"
          className={cn(
            // Wraps rather than being cut when the type panel leaves the table narrow (Portuguese).
            'inline-flex items-center justify-end gap-1 text-right text-13 font-medium',
            view.ready ? 'text-accent-strong' : 'text-ink-2',
          )}
        >
          {view.ready ? <Bot size={14} className="shrink-0" /> : null}
          {view.ready ? t('panorama.openReady') : t('panorama.open')}
        </span>
      </TCell>
    </TRow>
  )
}

function ReadyBanner({
  entry,
  onOpen,
}: {
  entry: CaseTypeStage
  onOpen(type: MaturingType): void
}) {
  const { t } = useTranslation(['automation', 'cases'])
  if (!isMaturing(entry.caseType)) return null
  const type = entry.caseType
  return (
    <Callout
      tone="info"
      icon={<Bot size={18} aria-hidden="true" />}
      title={t('panorama.readyTitle', { type: typeName(type) })}
      actions={
        <Button variant="primary" size="sm" onClick={() => onOpen(type)}>
          {t('panorama.readyAction')}
        </Button>
      }
    >
      {t('panorama.readyText', {
        asIs: entry.signals.draftsAsIs,
        drafts: entry.signals.drafts,
      })}
    </Callout>
  )
}
