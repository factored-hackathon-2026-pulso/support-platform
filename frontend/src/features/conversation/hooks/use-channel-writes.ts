import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { conversationMutationKeys, postCallLine, postNote, replyByEmail } from '../api'
import { emailToTurn } from '../channels'
import type { Language, PostTurnResponse } from '../types'
import { newClientMessageId, storeTurnResult } from './use-send-message'

/**
 * Writes of the call and email panels (slice 12). Not optimistic: the box keeps the text until
 * the server confirms (then it clears), and a failure stays next to the box. Each send carries
 * its own `clientMessageId` (= `Idempotency-Key`); "Reintentar" re-sends the same one.
 */
interface WriteInput {
  text: string
  clientMessageId?: string
}

function withId(input: WriteInput) {
  return { text: input.text, clientMessageId: input.clientMessageId ?? newClientMessageId() }
}

/** What the analyst says on the line (only while `in_call`). */
export function useCallLine(caseId: string, callId: string | null) {
  const queryClient = useQueryClient()
  return useMutation<PostTurnResponse, ApiProblem, WriteInput>({
    mutationKey: conversationMutationKeys.callLine(caseId),
    scope: { id: `send:${caseId}` },
    mutationFn: (input) => postCallLine(caseId, callId ?? '', withId(input)),
    onSuccess: (result) => storeTurnResult(queryClient, caseId, result),
  })
}

/** "Nota interna": a staff-only note in the transcript. */
export function useAddNote(caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<PostTurnResponse, ApiProblem, WriteInput>({
    mutationKey: conversationMutationKeys.note(caseId),
    scope: { id: `send:${caseId}` },
    mutationFn: (input) => postNote(caseId, withId(input)),
    onSuccess: (result) => storeTurnResult(queryClient, caseId, result),
  })
}

/** "Enviar correo": the platform frames it (greeting, signature) and threads it. */
export function useEmailReply(caseId: string, language: Language) {
  const queryClient = useQueryClient()
  return useMutation<
    void,
    ApiProblem,
    { body: string; subject: string | null; clientMessageId: string }
  >({
    mutationKey: conversationMutationKeys.email(caseId),
    scope: { id: `send:${caseId}` },
    mutationFn: async ({ body, subject, clientMessageId }) => {
      const result = await replyByEmail(caseId, {
        body,
        clientMessageId,
        ...(subject ? { subject } : {}),
      })
      storeTurnResult(queryClient, caseId, {
        turn: emailToTurn(result.email, language),
        case: result.case,
      })
    },
  })
}
