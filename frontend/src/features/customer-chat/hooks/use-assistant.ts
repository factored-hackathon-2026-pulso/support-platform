import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import {
  answerConfirmation,
  customerChatKeys,
  customerChatMutationKeys,
  requestPerson,
  verifyStepUp,
} from '../api'
import { describeAssistantFailure, type AssistantAction } from '../assistant'
import { applyConversation, emptyChat } from '../model'
import type { ConfirmationAnswer, CustomerChatCache, CustomerConversation } from '../types'

/**
 * The answer of every assistant command is the conversation now (contract §3.3–§3.5): it goes
 * into the chat cache at once (the assistant's reply arrives later as a turn). A failure after
 * which the conversation itself moved on (people have it, the confirmation was answered or
 * expired, the third wrong code) refetches it (`describeAssistantFailure(...).refetch`).
 */
function useApplyConversation(customerId: string, action: AssistantAction) {
  const queryClient = useQueryClient()
  const key = customerChatKeys.conversation(customerId)
  return {
    apply(conversation: CustomerConversation) {
      queryClient.setQueryData<CustomerChatCache>(key, (current) =>
        applyConversation(current ?? emptyChat(), conversation),
      )
    },
    failed(error: ApiProblem) {
      // Whether the conversation moved on does not depend on the language of the copy.
      if (describeAssistantFailure(error, action, 'es').refetch) {
        void queryClient.invalidateQueries({ queryKey: key, exact: true })
      }
    },
  }
}

/** "Sí" / "No" to the assistant's confirmation (`POST …/confirmation`). */
export function useAnswerConfirmation(customerId: string) {
  const { apply, failed } = useApplyConversation(customerId, 'confirm')
  return useMutation<
    CustomerConversation,
    ApiProblem,
    { token: string; answer: ConfirmationAnswer }
  >({
    mutationKey: customerChatMutationKeys.confirm(customerId),
    mutationFn: ({ token, answer }) => answerConfirmation(token, answer),
    onSuccess: apply,
    onError: failed,
  })
}

/** The second-factor code (`POST …/step-up`); a wrong one keeps the prompt with its attempts. */
export function useVerifyStepUp(customerId: string) {
  const { apply, failed } = useApplyConversation(customerId, 'step_up')
  return useMutation<CustomerConversation, ApiProblem, string>({
    mutationKey: customerChatMutationKeys.stepUp(customerId),
    mutationFn: (code) => verifyStepUp(code),
    onSuccess: apply,
    onError: failed,
  })
}

/** "Hablar con una persona" (`POST …/human`): the conversation goes to people. */
export function useRequestPerson(customerId: string) {
  const { apply, failed } = useApplyConversation(customerId, 'person')
  return useMutation<CustomerConversation, ApiProblem, void>({
    mutationKey: customerChatMutationKeys.person(customerId),
    mutationFn: () => requestPerson(),
    onSuccess: apply,
    onError: failed,
  })
}
