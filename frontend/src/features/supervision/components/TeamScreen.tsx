import { useCallback, useEffect, useState } from 'react'
import { Page, PageBody } from '@/components/layout'
import { PageHeader, SegmentedControl } from '@/components/ui'
import {
  analystsOfTeam,
  assignResultCopy,
  findCaseSummary,
  selectedTeam,
  teamPillLabels,
  teamSubtitle,
  type ActivityFilter,
  type TeamUrlState,
  type UrlStateChangeOptions,
} from '../model'
import { useNow } from '@/lib/hooks'
import { useQueueNotices, useQueueOverview, useSupervisionLive, useTeamOverview } from '../hooks'
import type { AssignmentResult, CaseSummary, TeamAnalyst } from '../types'
import { AnalystSheet } from './AnalystSheet'
import { AnalystsPanel } from './AnalystsPanel'
import { AssignCaseDialog } from './AssignCaseDialog'
import { QueuesColumn } from './QueuesColumn'
import { ResultStrip } from './ResultStrip'

/** Clock of the screen: SLA tags, waits and risk counts (minute resolution). */
export const TEAM_TICK_MS = 15_000

/** "Todos los equipos" pill value (team keys are slugs, never this). */
const ALL_TEAMS = '__todos'

export interface TeamScreenProps {
  state: TeamUrlState
  onStateChange(patch: Partial<TeamUrlState>, options?: UrlStateChangeOptions): void
  /** Open the read-only case view (the route carries the return URL). */
  onOpenCase(caseId: string): void
}

/**
 * Equipo y colas (SuTeam.dc.html, contract §8.4): the language queues and the
 * analysts, live through `supervision:queues` / `supervision:team`. Team and
 * queues load and fail independently. The URL holds the team, the state filter,
 * the analyst sheet and the assign dialog (`?equipo=&estado=&analista=&asignar=`).
 */
export function TeamScreen({ state, onStateChange, onOpenCase }: TeamScreenProps) {
  useSupervisionLive()
  useQueueNotices()
  const team = useTeamOverview()
  const queues = useQueueOverview()
  const now = useNow(TEAM_TICK_MS)
  const [result, setResult] = useState<{ prefix: string; message: string } | null>(null)

  const teams = team.data?.teams ?? []
  const current = selectedTeam(teams, state.team)
  const teamKey = current?.key ?? null
  const analysts = team.data?.analysts
  const subtitle = analysts
    ? teamSubtitle(current, analystsOfTeam(analysts, teamKey).length)
    : 'Cargando el equipo…'

  // ?analista= of someone not (or no longer) listed: close the sheet.
  const sheetAnalyst = state.analystId
    ? analysts?.find((analyst) => analyst.id === state.analystId)
    : undefined
  const unknownAnalyst = state.analystId !== null && team.status === 'success' && !sheetAnalyst
  useEffect(() => {
    if (unknownAnalyst) onStateChange({ analystId: null }, { replace: true })
  }, [unknownAnalyst, onStateChange])

  // ?asignar= of a case that is neither queued nor open any more: drop it.
  const assignSummary = state.assignCaseId
    ? findCaseSummary(state.assignCaseId, team.data, queues.data)
    : null
  const settled =
    team.status === 'success' &&
    queues.status === 'success' &&
    !team.isFetching &&
    !queues.isFetching
  const unknownCase = state.assignCaseId !== null && settled && !assignSummary
  useEffect(() => {
    if (unknownCase) onStateChange({ assignCaseId: null }, { replace: true })
  }, [unknownCase, onStateChange])

  const openAssign = useCallback(
    (caseId: string) => onStateChange({ assignCaseId: caseId }),
    [onStateChange],
  )
  const closeAssign = useCallback(
    () => onStateChange({ assignCaseId: null }, { replace: true }),
    [onStateChange],
  )

  function holderOf(summary: CaseSummary): string | null {
    if (!summary.assignedAnalystId) return null
    return analysts?.find((analyst) => analyst.id === summary.assignedAnalystId)?.name ?? null
  }

  function reportAssigned(summary: CaseSummary, _result: AssignmentResult, chosen: TeamAnalyst) {
    const queue = queues.data?.queues.find((q) => q.language === summary.language)
    setResult(
      assignResultCopy({
        customerName: summary.customer.displayName,
        analystName: chosen.name,
        previousAnalystName: summary.assignedAnalystId
          ? (holderOf(summary) ?? 'otra persona del equipo')
          : null,
        queueLanguage: summary.language,
        // Robust to the refetch landing before or after this response.
        queueRemaining: queue ? queue.cases.filter((c) => c.id !== summary.id).length : 0,
      }),
    )
  }

  const pillLabels = teamPillLabels(teams)

  return (
    <Page
      header={
        <PageHeader
          title="Equipo y colas"
          subtitle={subtitle}
          sampleData
          actions={
            teams.length > 0 ? (
              <SegmentedControl
                label="Equipo"
                variant="pills"
                value={teamKey ?? ALL_TEAMS}
                onValueChange={(value) =>
                  onStateChange({ team: value === ALL_TEAMS ? null : value }, { replace: true })
                }
                options={[
                  { value: ALL_TEAMS, label: 'Todos los equipos' },
                  ...teams.map((t) => ({ value: t.key, label: pillLabels[t.key] ?? t.name })),
                ]}
              />
            ) : null
          }
        />
      }
      toolbar={<ResultStrip result={result} onDismiss={() => setResult(null)} />}
    >
      <PageBody
        scroll={false}
        className="grid grid-cols-[440px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-4"
      >
        <QueuesColumn query={queues} now={now} onAssign={openAssign} onOpenCase={onOpenCase} />
        <AnalystsPanel
          query={team}
          teamKey={teamKey}
          filter={state.activity}
          selectedAnalystId={state.analystId}
          now={now}
          onFilterChange={(activity: ActivityFilter) =>
            onStateChange({ activity }, { replace: true })
          }
          onSelectAnalyst={(analystId) => onStateChange({ analystId })}
        />
      </PageBody>

      {sheetAnalyst ? (
        <AnalystSheet
          analyst={sheetAnalyst}
          now={now}
          onClose={() => onStateChange({ analystId: null })}
          onOpenCase={onOpenCase}
          onReassign={openAssign}
        />
      ) : null}

      {assignSummary && analysts ? (
        <AssignCaseDialog
          key={assignSummary.id}
          summary={assignSummary}
          analysts={analysts}
          holderName={holderOf(assignSummary)}
          now={now}
          onClose={closeAssign}
          onAssigned={(assigned, chosen) => reportAssigned(assignSummary, assigned, chosen)}
        />
      ) : null}
    </Page>
  )
}
