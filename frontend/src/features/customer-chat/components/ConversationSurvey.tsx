import { surveyState } from '../model'
import { useRateConversation } from '../hooks'
import type { CustomerConversation, Language } from '../types'
import { RatedPill, RatingSurvey } from './RatingSurvey'

export interface ConversationSurveyProps {
  customerId: string
  conversation: CustomerConversation | null
  language: Language
  /** "Ahora no" (`useSkippedRatings` of the view, which also hides its composer meanwhile). */
  skipped: ReadonlySet<string>
  onSkip(caseId: string): void
}

/**
 * The satisfaction survey of the call and email views (slice 12; the chat keeps its own in
 * place of the composer): once the conversation closes it asks, then the thanks pill stays.
 */
export function ConversationSurvey({
  customerId,
  conversation,
  language,
  skipped,
  onSkip,
}: ConversationSurveyProps) {
  const rate = useRateConversation(customerId)
  const state = surveyState(conversation, skipped)
  return (
    <>
      {state === 'ask' && conversation ? (
        <RatingSurvey
          key={conversation.caseId}
          caseId={conversation.caseId}
          agentName={conversation.agentName}
          language={language}
          sending={rate.isPending}
          error={rate.isError ? rate.error : null}
          onSend={(input) => rate.mutate(input)}
          onSkip={(caseId) => {
            onSkip(caseId)
            rate.reset()
          }}
        />
      ) : null}
      <output className="flex flex-col empty:hidden">
        {state === 'rated' && conversation?.rating ? (
          <RatedPill rating={conversation.rating} language={language} />
        ) : null}
      </output>
    </>
  )
}
