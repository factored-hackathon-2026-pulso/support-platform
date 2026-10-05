import { useCallback, useEffect, useState } from 'react'
import { Page, PageBody } from '@/components/layout'
import {
  FilterChips,
  FilterMenu,
  PageHeader,
  activeFilterChips,
  toggleFilter,
  type FilterSelection,
} from '@/components/ui'
import { useNow } from '@/lib/hooks'
import { useTranslation } from '@/lib/i18n'
import {
  filterAnalysts,
  findOpenCase,
  reassignResultCopy,
  teamFilterGroups,
  teamSelection,
  teamStateFromSelection,
  teamSubtitle,
} from '../model'
import type { TeamUrlState, UrlStateChangeOptions } from '../url'
import { useIsAssigning, useSupervisionLive, useTeamOverview } from '../hooks'
import type { CaseSummary } from '../types'
import { AnalystSheet } from './AnalystSheet'
import { AnalystsPanel } from './AnalystsPanel'
import { ReassignDialog } from './ReassignDialog'
import { ResultStrip } from './ResultStrip'
import { SUPERVISION_TICK_MS } from './QueuesScreen'

/** Kept for the case view and older imports: the supervision clock. */
export const TEAM_TICK_MS = SUPERVISION_TICK_MS

export interface TeamScreenProps {
  state: TeamUrlState
  onStateChange(patch: Partial<TeamUrlState>, options?: UrlStateChangeOptions): void
  /** Open the read-only case view (the route carries the return URL). */
  onOpenCase(caseId: string): void
}

/**
 * "Equipo" (SuTeam.dc.html, slice 9): one table of every analyst, live through
 * `supervision:team`. The team is a filter (never a tab): one "Filtros" dropdown (Estado,
 * Idioma, Equipo, each with its count) and removable chips, all in the URL
 * (`?status=&language=&team=&analyst=&reassign=`). The analyst sheet lists her open
 * cases with "Reasignar".
 */
export function TeamScreen({ state, onStateChange, onOpenCase }: TeamScreenProps) {
  const { t } = useTranslation('supervision')
  useSupervisionLive()
  const team = useTeamOverview()
  const now = useNow(SUPERVISION_TICK_MS)
  const [result, setResult] = useState<{ message: string } | null>(null)

  const analysts = team.data?.analysts
  const groups = team.data ? teamFilterGroups(team.data, state) : []
  const selection = teamSelection(state)
  const chips = activeFilterChips(groups, selection)
  const shown = analysts ? filterAnalysts(analysts, state) : []
  const update = (next: FilterSelection) =>
    onStateChange(teamStateFromSelection(state, next), { replace: true })
  const clear = () => onStateChange({ activities: [], languages: [], teams: [] }, { replace: true })

  // ?analyst= of someone not (or no longer) listed: close the sheet.
  const sheetAnalyst = state.analystId
    ? analysts?.find((analyst) => analyst.id === state.analystId)
    : undefined
  const unknownAnalyst = state.analystId !== null && team.status === 'success' && !sheetAnalyst
  useEffect(() => {
    if (unknownAnalyst) onStateChange({ analystId: null }, { replace: true })
  }, [unknownAnalyst, onStateChange])

  // ?reassign=: the open case as the overview shows it now. Keep the last one while the
  // reassignment is in flight (the refetch may move it under another analyst first).
  const liveSummary = state.reassignCaseId ? findOpenCase(state.reassignCaseId, team.data) : null
  const [keptSummary, setKeptSummary] = useState<CaseSummary | null>(null)
  if (liveSummary && liveSummary !== keptSummary) setKeptSummary(liveSummary)
  const reassignSummary =
    liveSummary ?? (keptSummary && keptSummary.id === state.reassignCaseId ? keptSummary : null)
  const assigning = useIsAssigning(state.reassignCaseId)
  const settled = team.status === 'success' && !team.isFetching
  const unknownCase = state.reassignCaseId !== null && settled && !liveSummary && !assigning
  useEffect(() => {
    if (unknownCase) onStateChange({ reassignCaseId: null }, { replace: true })
  }, [unknownCase, onStateChange])

  const openReassign = useCallback(
    (caseId: string) => onStateChange({ reassignCaseId: caseId }),
    [onStateChange],
  )
  const closeReassign = useCallback(
    () => onStateChange({ reassignCaseId: null }, { replace: true }),
    [onStateChange],
  )

  function holderOf(summary: CaseSummary): string | null {
    if (!summary.assignedAnalystId) return null
    return analysts?.find((analyst) => analyst.id === summary.assignedAnalystId)?.name ?? null
  }

  return (
    <Page
      header={
        <PageHeader
          title={t('team.title')}
          subtitle={
            analysts
              ? teamSubtitle(shown.length, analysts.length, chips.length > 0)
              : t('team.loading')
          }
          actions={
            <div className="flex flex-col items-end gap-2">
              <FilterMenu
                groups={groups}
                selection={selection}
                align="end"
                onToggle={(group, value) => update(toggleFilter(selection, group, value))}
                onClear={clear}
              />
            </div>
          }
        />
      }
      toolbar={
        <>
          {chips.length ? (
            <div className="shrink-0 border-b border-border bg-surface px-7 py-2">
              <FilterChips
                chips={chips}
                onRemove={(group, value) => update(toggleFilter(selection, group, value))}
                onClear={clear}
              />
            </div>
          ) : null}
          <ResultStrip result={result} onDismiss={() => setResult(null)} />
        </>
      }
    >
      <PageBody scroll={false} className="flex min-h-0 flex-col">
        <AnalystsPanel
          query={team}
          analysts={shown}
          filtered={chips.length > 0}
          selectedAnalystId={state.analystId}
          now={now}
          onSelectAnalyst={(analystId) => onStateChange({ analystId })}
          onClearFilters={clear}
        />
      </PageBody>

      {sheetAnalyst ? (
        <AnalystSheet
          analyst={sheetAnalyst}
          now={now}
          onClose={() => onStateChange({ analystId: null })}
          onOpenCase={onOpenCase}
          onReassign={openReassign}
        />
      ) : null}

      {reassignSummary && analysts ? (
        <ReassignDialog
          key={reassignSummary.id}
          summary={reassignSummary}
          analysts={analysts}
          holderName={holderOf(reassignSummary)}
          onClose={closeReassign}
          onReassigned={(_result, chosen) =>
            setResult(
              reassignResultCopy({
                customerName: reassignSummary.customer.displayName,
                previousAnalystName: holderOf(reassignSummary),
                analystName: chosen.name,
              }),
            )
          }
        />
      ) : null}
    </Page>
  )
}
