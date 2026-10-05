import { useQuery, useQueryClient } from '@tanstack/react-query'
import { topics, useOnReconnect, useRealtimeSubscription } from '@/lib/realtime'
import { customerChatKeys, fetchCustomerPlatform } from '../api'

/**
 * The AI switch as the simulator sees it (slice 18): GET /customer/platform, live through
 * `platform.updated` on `platform:settings` (the customer socket), refetched after a
 * reconnect. False while unknown. The simulator has no AI element yet (slice 19 adds the
 * assistant): today it only exposes the state on its root (`data-ai-enabled`).
 */
export function useSimulatorAiEnabled(): boolean {
  const queryClient = useQueryClient()
  useRealtimeSubscription(topics.platformSettings())
  useOnReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: customerChatKeys.platform() })
  })
  const query = useQuery({
    queryKey: customerChatKeys.platform(),
    queryFn: ({ signal }) => fetchCustomerPlatform(signal),
    staleTime: Infinity,
  })
  return query.data?.aiEnabled === true
}
