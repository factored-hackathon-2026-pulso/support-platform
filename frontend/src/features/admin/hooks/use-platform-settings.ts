import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { primePlatformSettings } from '@/app/platform'
import { useToast } from '@/components/ui'
import type { ApiProblem } from '@/lib/api'
import { topics, useOnReconnect, useRealtimeSubscription } from '@/lib/realtime'
import { adminKeys, adminMutationKeys, fetchAdminPlatform, setAiEnabled } from '../api'
import { aiToggledToast, describeAiToggleFailure } from '../platform'
import type { AdminPlatformSettings, SetAiEnabledResult } from '../types'

/**
 * GET /admin/platform (slice 18), live: `platform.updated` (another admin changed it)
 * refetches it (admin realtime.ts); the topic is followed here too, so the screen is right
 * even before the shell's subscription is in place.
 */
export function useAdminPlatform(): UseQueryResult<AdminPlatformSettings, ApiProblem> {
  const queryClient = useQueryClient()
  useRealtimeSubscription(topics.platformSettings())
  useOnReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.platform() })
  })
  return useQuery<AdminPlatformSettings, ApiProblem>({
    queryKey: adminKeys.platform(),
    queryFn: ({ signal }) => fetchAdminPlatform(signal),
  })
}

/**
 * PUT /admin/platform/ai, optimistic: the switch moves at once; the answer replaces the
 * settings and the app's own switch (`app/platform.ts`) follows without waiting for the
 * socket. A failure puts the previous state back and says why.
 */
export function useSetAiEnabled() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation<
    SetAiEnabledResult,
    ApiProblem,
    boolean,
    { previous: AdminPlatformSettings | undefined }
  >({
    mutationKey: adminMutationKeys.setAiEnabled,
    mutationFn: (enabled) => setAiEnabled(enabled),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: adminKeys.platform() })
      const previous = queryClient.getQueryData<AdminPlatformSettings>(adminKeys.platform())
      if (previous) {
        queryClient.setQueryData<AdminPlatformSettings>(adminKeys.platform(), {
          ...previous,
          aiEnabled: enabled,
        })
      }
      return { previous }
    },
    onSuccess: (result) => {
      queryClient.setQueryData(adminKeys.platform(), result.settings)
      primePlatformSettings(queryClient, { aiEnabled: result.settings.aiEnabled })
      if (result.changed) toast(aiToggledToast(result.settings.aiEnabled))
    },
    onError: (error, _enabled, context) => {
      if (context?.previous) queryClient.setQueryData(adminKeys.platform(), context.previous)
      toast({ ...describeAiToggleFailure(error), politeness: 'alert' })
    },
  })
}
