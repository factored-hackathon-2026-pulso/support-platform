import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { customerSessionToken } from '@/lib/session-token'
import { createCustomerSession, customerChatKeys, customerChatMutationKeys } from '../api'
import { decodeCustomerToken, type CustomerTokenClaims } from '../model'
import type { CustomerSessionResponse } from '../types'

function useCustomerToken(): string | null {
  return useSyncExternalStore(
    customerSessionToken.subscribe,
    customerSessionToken.get,
    customerSessionToken.get,
  )
}

export interface CustomerSession extends CustomerTokenClaims {
  token: string
}

/**
 * Simulator session: the customer token lives in `customerSessionToken`
 * (sessionStorage, apart from the staff session), so a reload restores the chat.
 * An unreadable or expired token is dropped.
 */
export function useCustomerSession() {
  const token = useCustomerToken()
  const queryClient = useQueryClient()
  // Expiry is checked when the simulator opens; later the server's 401 drops the token.
  const [openedAt] = useState(() => Date.now())
  const session = useMemo<CustomerSession | null>(() => {
    if (!token) return null
    const claims = decodeCustomerToken(token, openedAt)
    return claims ? { ...claims, token } : null
  }, [token, openedAt])

  useEffect(() => {
    if (token && !session) customerSessionToken.clear()
  }, [token, session])

  const start = useMutation<CustomerSessionResponse, ApiProblem, string>({
    mutationKey: customerChatMutationKeys.start,
    mutationFn: (customerId) => createCustomerSession({ customerId }),
    onSuccess: ({ token: next }) => customerSessionToken.set(next),
  })

  /** "Cambiar de cliente": drop the token and that customer's cached chat. */
  function end() {
    if (session)
      queryClient.removeQueries({ queryKey: customerChatKeys.conversation(session.customerId) })
    customerSessionToken.clear()
    start.reset()
    void queryClient.invalidateQueries({ queryKey: customerChatKeys.demoCustomers() })
  }

  return { session, start, end }
}
