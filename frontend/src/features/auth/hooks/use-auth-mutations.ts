import { useMutation } from '@tanstack/react-query'
import { authMutationKeys, login, verifyMfa } from '../api'

/** POST /auth/login. Errors are ApiProblem; map them with `describeLoginFailure`. */
export function useLoginMutation() {
  return useMutation({ mutationKey: authMutationKeys.login, mutationFn: login })
}

/** POST /auth/mfa. Errors are ApiProblem; map them with `describeMfaFailure`. */
export function useVerifyMfaMutation() {
  return useMutation({ mutationKey: authMutationKeys.mfa, mutationFn: verifyMfa })
}
