import { useId, useState, type FormEvent } from 'react'
import { Bot, Clock, KeyRound, ShieldCheck, User } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useNow } from '@/lib/hooks'
import {
  STEP_UP_CODE_LENGTH,
  assistantCopy,
  confirmationExpiry,
  describeAssistantFailure,
  isConfirmationExpired,
  normalizeStepUpCode,
  type AssistantConfirmation,
  type AssistantStepUp,
} from '../assistant'
import { useAnswerConfirmation, useRequestPerson, useVerifyStepUp } from '../hooks'
import type { Language } from '../types'

/** The assistant's mark: lucide's stroke `bot`, in the text color. */
export function AssistantIcon({ size = 13, className }: { size?: number; className?: string }) {
  return <Bot size={size} aria-hidden="true" className={cn('shrink-0', className)} />
}

const PRIMARY =
  'min-h-11 cursor-pointer rounded-full border-0 bg-app-brand px-[18px] text-15 font-semibold text-white hover:bg-app-brand-strong aria-disabled:cursor-wait aria-disabled:opacity-60'
const OUTLINE =
  'min-h-11 cursor-pointer rounded-full border border-app-chip-line bg-white px-[18px] text-15 font-semibold text-app-ink hover:border-app-brand aria-disabled:cursor-wait aria-disabled:opacity-60'
const CARD = 'flex flex-col gap-2.5 rounded-14 border border-app-chip-line bg-white p-3.5'

/** "El asistente virtual está escribiendo…": three dots in a pill (static with reduced motion). */
export function AssistantTyping({ language }: { language: Language }) {
  const copy = assistantCopy(language)
  return (
    <span className="inline-flex items-center gap-2 self-start rounded-full bg-white px-3 py-2 text-13 text-app-muted">
      <span aria-hidden="true" className="inline-flex gap-[3px]">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="size-1.5 rounded-full bg-app-muted/60 motion-safe:animate-pulse"
            style={{ animationDelay: `${dot * 160}ms` }}
          />
        ))}
      </span>
      {copy.typing}
    </span>
  )
}

/**
 * "Hablar con una persona" (contract §3.5): offered permanently while the assistant holds the
 * conversation. `compact` is the header pill; otherwise a full-width outline button (inside
 * a call or email failure). Errors are shown under it, in the customer's language.
 */
export function AskPersonButton({
  customerId,
  language,
  compact = false,
  onDone,
}: {
  customerId: string
  language: Language
  compact?: boolean
  onDone?(): void
}) {
  const copy = assistantCopy(language)
  const person = useRequestPerson(customerId)
  const failure = person.isError ? describeAssistantFailure(person.error, 'person', language) : null
  return (
    <span className={cn('flex flex-col gap-1', compact ? 'mt-2 items-start' : 'items-stretch')}>
      <button
        type="button"
        aria-disabled={person.isPending || undefined}
        aria-busy={person.isPending || undefined}
        onClick={() => {
          if (person.isPending) return
          person.mutate(undefined, { onSuccess: () => onDone?.() })
        }}
        className={cn(
          'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-app-chip-line bg-white font-semibold text-app-brand hover:border-app-brand aria-disabled:cursor-wait aria-disabled:opacity-60',
          compact ? 'min-h-8 px-3 text-13' : 'min-h-11 px-4 text-15',
        )}
      >
        <User size={14} aria-hidden="true" />
        {copy.askPerson}
      </button>
      {failure ? (
        <span role="alert" className="text-12 font-medium text-danger-strong">
          {failure.message}
        </span>
      ) : null}
    </span>
  )
}

/**
 * "Confirma para seguir" (contract §3.3): what the assistant is about to do, when the question
 * expires, "No" and "Sí". The answer comes back as the conversation; the assistant's reply as a
 * turn. An expired confirmation still sends (the server says `confirmation_expired`).
 */
export function ConfirmationCard({
  customerId,
  confirmation,
  language,
}: {
  customerId: string
  confirmation: AssistantConfirmation
  language: Language
}) {
  const copy = assistantCopy(language)
  const titleId = useId()
  const answer = useAnswerConfirmation(customerId)
  const now = useNow(15_000)
  const expired = isConfirmationExpired(confirmation, now)
  const failure = answer.isError
    ? describeAssistantFailure(answer.error, 'confirm', language)
    : null
  const busy = answer.isPending

  function send(value: 'yes' | 'no') {
    if (busy) return
    answer.mutate({ token: confirmation.token, answer: value })
  }

  return (
    <section aria-labelledby={titleId} className={CARD}>
      <h3
        id={titleId}
        className="m-0 inline-flex items-center gap-1.5 text-12 font-semibold text-app-muted"
      >
        <ShieldCheck size={14} aria-hidden="true" />
        {copy.confirmTitle}
      </h3>
      <p className="m-0 text-16 leading-[1.35] font-bold text-app-ink">{confirmation.summary}</p>
      <p
        className={cn(
          'm-0 inline-flex items-center gap-1.5 text-12',
          expired ? 'font-medium text-danger-strong' : 'text-app-muted',
        )}
      >
        <Clock size={13} aria-hidden="true" />
        {expired ? copy.expired : confirmationExpiry(confirmation, language)}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className={OUTLINE}
          aria-disabled={busy || undefined}
          aria-busy={(busy && answer.variables?.answer === 'no') || undefined}
          onClick={() => send('no')}
        >
          {copy.no}
        </button>
        <button
          type="button"
          className={PRIMARY}
          aria-disabled={busy || undefined}
          aria-busy={(busy && answer.variables?.answer === 'yes') || undefined}
          onClick={() => send('yes')}
        >
          {copy.yes}
        </button>
      </div>
      {failure ? (
        <p role="alert" className="m-0 text-13 font-medium text-danger-strong">
          {failure.message}
        </p>
      ) : null}
    </section>
  )
}

/**
 * "Confirma que eres tú" (contract §3.4): a six-digit code. While `simulated` the prompt says it
 * is a development stand-in and which code it takes. A wrong code says how many attempts are
 * left; the third one hands the conversation to people (the chat refetches and follows).
 */
export function StepUpCard({
  customerId,
  stepUp,
  language,
}: {
  customerId: string
  stepUp: AssistantStepUp
  language: Language
}) {
  const copy = assistantCopy(language)
  const titleId = useId()
  const inputId = useId()
  const errorId = useId()
  const verify = useVerifyStepUp(customerId)
  const [code, setCode] = useState('')
  const failure = verify.isError
    ? describeAssistantFailure(verify.error, 'step_up', language)
    : null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (verify.isPending || code.length < STEP_UP_CODE_LENGTH) return
    verify.mutate(code, { onSettled: () => setCode('') })
  }

  return (
    <form aria-labelledby={titleId} onSubmit={submit} className={CARD}>
      <h3
        id={titleId}
        className="m-0 inline-flex items-center gap-1.5 text-16 font-bold text-app-ink"
      >
        <KeyRound size={16} aria-hidden="true" />
        {copy.stepUpTitle}
      </h3>
      <p className="m-0 text-13 text-app-muted">{copy.stepUpReason}</p>
      <label htmlFor={inputId} className="text-13 font-semibold">
        {copy.codeLabel}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={STEP_UP_CODE_LENGTH}
          value={code}
          aria-invalid={failure ? true : undefined}
          aria-describedby={failure ? errorId : undefined}
          onChange={(event) => {
            setCode(normalizeStepUpCode(event.target.value))
            if (verify.isError) verify.reset()
          }}
          className="min-h-11 w-0 grow rounded-12 border border-app-chip-line bg-white px-3.5 font-mono text-18 tracking-[0.3em] text-app-ink"
        />
        <button
          type="submit"
          className={PRIMARY}
          aria-disabled={verify.isPending || code.length < STEP_UP_CODE_LENGTH || undefined}
          aria-busy={verify.isPending || undefined}
        >
          {copy.verify}
        </button>
      </div>
      {failure ? (
        <p id={errorId} role="alert" className="m-0 text-13 font-medium text-danger-strong">
          {failure.message}
        </p>
      ) : null}
      {stepUp.simulated ? (
        <span className="self-start rounded-full bg-accent-soft px-2 py-0.5 text-12 font-semibold text-accent-strong">
          {copy.simulated}
        </span>
      ) : null}
    </form>
  )
}
