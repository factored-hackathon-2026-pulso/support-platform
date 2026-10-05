import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useAiEnabled } from '@/app/platform'
import type { ApiProblem } from '@/lib/api'
import { topics, useOnReconnect, useRealtimeSubscription } from '@/lib/realtime'
import { copilotKeys, fetchAiStages } from '../api'
import type { AiStages } from '../stages'

/**
 * GET /ai/stages (slice 21): every case type's stage, while AI is on. Live: it follows
 * `ai:stages` (`ai.stage_updated` reads it again, realtime.ts) and refetches after a reconnect.
 * A switch turned off disables it (the stages and the copilot go away with the switch).
 */
export function useAiStages(): UseQueryResult<AiStages, ApiProblem> {
  const aiEnabled = useAiEnabled()
  const queryClient = useQueryClient()
  useRealtimeSubscription(aiEnabled ? topics.aiStages() : null)
  useOnReconnect(
    () => void queryClient.invalidateQueries({ queryKey: copilotKeys.stages() }),
    aiEnabled,
  )
  return useQuery<AiStages, ApiProblem>({
    queryKey: copilotKeys.stages(),
    queryFn: ({ signal }) => fetchAiStages(signal),
    enabled: aiEnabled,
    staleTime: 60_000,
  })
}
