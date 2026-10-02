import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { availabilityKeys, caseMutationKeys, fetchAvailability, updateAvailability } from '../api'
import type { Availability, AvailabilityStatus } from '../types'

/** GET /me/availability ("Disponible" / "En pausa"). */
export function useAvailability(): UseQueryResult<Availability, ApiProblem> {
  return useQuery<Availability, ApiProblem>({
    queryKey: availabilityKeys.me(),
    queryFn: ({ signal }) => fetchAvailability(signal),
  })
}

/**
 * PUT /me/availability, optimistic: the pill flips at once and rolls back if the
 * server refuses. The server answer (with its `since`) replaces the guess.
 */
export function useUpdateAvailability() {
  const queryClient = useQueryClient()
  return useMutation<Availability, ApiProblem, AvailabilityStatus, { previous?: Availability }>({
    mutationKey: caseMutationKeys.updateAvailability,
    mutationFn: (status) => updateAvailability(status),
    onMutate: async (status) => {
      await queryClient.cancelQueries({ queryKey: availabilityKeys.me() })
      const previous = queryClient.getQueryData<Availability>(availabilityKeys.me())
      queryClient.setQueryData<Availability>(availabilityKeys.me(), {
        status,
        since: previous?.status === status ? previous.since : new Date().toISOString(),
      })
      return { previous }
    },
    onError: (_error, _status, context) => {
      if (context?.previous) queryClient.setQueryData(availabilityKeys.me(), context.previous)
      else void queryClient.invalidateQueries({ queryKey: availabilityKeys.me() })
    },
    onSuccess: (availability) => {
      queryClient.setQueryData(availabilityKeys.me(), availability)
    },
  })
}
