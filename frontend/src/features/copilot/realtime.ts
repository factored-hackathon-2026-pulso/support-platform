/**
 * Copilot realtime (slice 15b §4): `copilot.suggestion_updated` on the analyst's own
 * `inbox:<staffId>` carries only the suggestion id and its status; the content is read over REST
 * (copilot content never travels on a socket). Registered in `app/realtime-handlers.ts`; keep this
 * module light (keys + handlers only).
 *
 * A customer's turn makes the newest suggestion stale (`stale: true`), so `turn.created` from the
 * customer reads it again too, for a case whose suggestion is cached. Slice 21: `ai.stage_updated`
 * on `ai:stages` reads the stages per case type again.
 */
import type { QueryClient } from '@tanstack/react-query'
import {
  envelopeCaseId,
  envelopePayload,
  type RealtimeEnvelope,
  type RealtimeRegistration,
} from '@/lib/realtime'
import { copilotKeys } from './api'

function refreshLatest(caseId: string, queryClient: QueryClient): void {
  const key = copilotKeys.latest(caseId)
  if (queryClient.getQueryData(key) === undefined) return // Nobody shows it: the first read brings it.
  void queryClient.invalidateQueries({ queryKey: key, exact: true })
}

function onSuggestionUpdated(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const caseId = envelopeCaseId(envelope)
  if (caseId) refreshLatest(caseId, queryClient)
}

function onTurnCreated(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const payload = envelopePayload(envelope)
  const caseId = envelopeCaseId(envelope)
  if (!caseId || payload?.authorRole !== 'customer') return
  refreshLatest(caseId, queryClient)
}

/** Slice 21: a case type changed stage (`ai:stages`): read the stages again. */
function onStageUpdated(_envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: copilotKeys.stages() })
  // A photo picked while the agent is reviewed (no type yet) lives on the agent's own profile.
  void queryClient.invalidateQueries({ queryKey: ['automation', 'agent'] })
}

export const registerCopilotRealtime: RealtimeRegistration = (registry) => {
  registry.register('copilot.suggestion_updated', onSuggestionUpdated)
  registry.register('turn.created', onTurnCreated)
  registry.register('ai.stage_updated', onStageUpdated)
}
