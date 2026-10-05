import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useAiEnabled } from '@/app/platform'
import { useCurrentUser } from '@/app/session'
import type { ApiProblem } from '@/lib/api'
import { conversationKeys, fetchCaseHandoff } from '../api'
import { hasHandoff, readHandoff, type HandoffView } from '../handoff'
import type { CaseDetail } from '../types'

/**
 * The assistant's handoff of a case that reached her from an escalation (slice 19): read only
 * while AI is on, only by her (the assignee), once (the packet does not change). Shared by the
 * card on top of the conversation, the "Traspaso" tab and the close dialog (one request). An
 * agent-core outage is retried once, then the screens offer "Reintentar"; the conversation
 * never waits for it. `null` detail (still loading) or another case: disabled.
 */
export function useCaseHandoff(detail: Pick<CaseDetail, 'case' | 'assignment'> | undefined): {
  handoff: UseQueryResult<HandoffView, ApiProblem>
  available: boolean
} {
  const me = useCurrentUser()
  const aiEnabled = useAiEnabled()
  const available = aiEnabled && detail !== undefined && hasHandoff(detail, me.id)
  const caseId = detail?.case.id ?? ''
  const handoff = useQuery<HandoffView, ApiProblem>({
    queryKey: conversationKeys.handoff(caseId),
    queryFn: async ({ signal }) => readHandoff((await fetchCaseHandoff(caseId, signal)).packet),
    enabled: available,
    staleTime: Infinity,
    retry: (failures, error) => failures < 1 && error.status >= 500,
  })
  return { handoff, available }
}
