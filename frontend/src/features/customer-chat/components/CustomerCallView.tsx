import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react'
import { Callout } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatTimer, getInitials } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import {
  customerCallCopy,
  customerCallLines,
  customerCallPhase,
  customerCallSeconds,
  customerCallSubline,
  customerCallTitle,
  describeCustomerCallFailure,
  isCustomerCallActive,
} from '../channels'
import {
  useCustomerCall,
  useCustomerCallCommand,
  useCustomerCallLine,
  useCustomerConversation,
  useSkippedRatings,
  useStartCustomerCall,
} from '../hooks'
import { isAssistantActive } from '../assistant'
import { chatLang, normalizeCustomerMessage } from '../model'
import type { Language } from '../types'
import { AskPersonButton } from './AssistantControls'
import { ConversationSurvey } from './ConversationSurvey'

export interface CustomerCallViewProps {
  customerId: string
  language: Language
}

const pill =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-15 font-semibold aria-disabled:cursor-not-allowed aria-disabled:opacity-50'

/**
 * The customer's side of a call (slice 12, Main.dc.html "llamada"), framed like the app:
 * "Llamando…" while it rings, then "Te atiende {nombre}" with the timer, "Silenciar" (only on
 * this screen: the customer's microphone) and "Colgar"; what both sides say, and a box for
 * what the customer says. A call of the bank rings here too ("Contestar" / "Rechazar").
 */
export function CustomerCallView({ customerId, language }: CustomerCallViewProps) {
  const copy = customerCallCopy(language)
  const chat = useCustomerConversation(customerId)
  const callQuery = useCustomerCall(customerId)
  const call = callQuery.data ?? null
  // Until the first answer the phase is unknown: no title or buttons that would flash.
  const loading = callQuery.isPending
  const phase = customerCallPhase(call)
  const active = isCustomerCallActive(call)
  const now = useNow(1000, active)
  const command = useCustomerCallCommand(customerId)
  const start = useStartCustomerCall(customerId)
  const line = useCustomerCallLine(customerId)
  const { skipped, skip } = useSkippedRatings()
  const [muted, setMuted] = useState(false)
  const [text, setText] = useState('')
  const [lineKey, setLineKey] = useState<string | null>(null)
  const lines = customerCallLines(chat.data?.turns ?? [], call, language)
  const scrollRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [lines.length])

  const talking = phase === 'live'
  const message = normalizeCustomerMessage(text)
  const canSay = talking && !muted && message !== null && !line.isPending
  const subline = customerCallSubline(call, language)
  const failure = command.error ?? start.error ?? line.error

  function act(kind: 'answer' | 'reject' | 'hangup') {
    if (!call || command.isPending) return
    command.mutate({ callId: call.id, command: kind })
    if (kind !== 'answer') setMuted(false)
  }

  function say(event: FormEvent) {
    event.preventDefault()
    if (!call || !canSay || !message) return
    const clientMessageId = lineKey ?? crypto.randomUUID()
    setLineKey(clientMessageId)
    line.mutate(
      { callId: call.id, text: message, clientMessageId },
      {
        onSuccess: () => {
          setText('')
          setLineKey(null)
        },
      },
    )
  }

  return (
    <section
      aria-label={copy.section}
      lang={chatLang(language)}
      className="mx-auto flex h-full max-h-[844px] w-full max-w-[390px] flex-col overflow-hidden rounded-16 border border-app-line bg-app-canvas text-app-ink shadow-popover"
    >
      <header className="flex shrink-0 flex-col items-center gap-1.5 border-b border-app-line bg-white px-5 pt-[22px] pb-4 text-center">
        <span
          aria-hidden="true"
          className={cn(
            'text-19 flex size-[60px] items-center justify-center rounded-full font-semibold',
            phase === 'ended' || phase === 'none'
              ? 'bg-panel text-ink-2'
              : 'bg-app-rate-good text-app-rate-ink',
          )}
        >
          {phase === 'live' || phase === 'hold' ? (
            // i18n-ignore-next-line: the brand's initials, not copy
            getInitials(call?.agentName ?? 'LATAM Bank')
          ) : phase === 'ended' || phase === 'none' ? (
            <PhoneOff size={24} />
          ) : (
            <Phone size={24} />
          )}
        </span>
        <output className="text-17 font-semibold">
          {loading ? null : customerCallTitle(call, language)}
        </output>
        {call && active && phase !== 'incoming' ? (
          <span className="inline-flex items-center gap-2 text-14 text-app-muted">
            {talking ? (
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-success motion-safe:animate-pulse"
              />
            ) : null}
            <span className="font-mono">
              <span className="sr-only">{copy.durationLabel} </span>
              {formatTimer(customerCallSeconds(call, now))}
            </span>
            {muted ? (
              <span className="inline-flex items-center gap-1 font-semibold text-app-ink">
                <MicOff size={13} aria-hidden="true" />
                {copy.muted}
              </span>
            ) : null}
          </span>
        ) : null}
        {subline ? <span className="text-13 text-app-muted">{subline}</span> : null}
        {phase === 'incoming' ? (
          <div className="mt-2 flex w-full gap-2">
            <button
              type="button"
              className={cn(pill, 'grow border-0 bg-danger text-white hover:bg-danger-strong')}
              onClick={() => act('reject')}
            >
              <PhoneOff size={16} aria-hidden="true" />
              {copy.reject}
            </button>
            <button
              type="button"
              className={cn(
                pill,
                'grow border-0 bg-app-brand text-white hover:bg-app-brand-strong',
              )}
              onClick={() => act('answer')}
            >
              <Phone size={16} aria-hidden="true" />
              {copy.answer}
            </button>
          </div>
        ) : active ? (
          <div className="mt-2 flex w-full gap-2">
            {phase === 'live' || phase === 'hold' ? (
              <button
                type="button"
                aria-pressed={muted}
                onClick={() => setMuted((value) => !value)}
                className={cn(
                  pill,
                  'grow border',
                  muted
                    ? 'border-app-ink bg-app-ink text-white'
                    : 'border-app-chip-line bg-white text-app-ink',
                )}
              >
                {muted ? (
                  <MicOff size={16} aria-hidden="true" />
                ) : (
                  <Mic size={16} aria-hidden="true" />
                )}
                {copy.mute}
              </button>
            ) : null}
            <button
              type="button"
              className={cn(pill, 'grow border-0 bg-danger text-white hover:bg-danger-strong')}
              onClick={() => act('hangup')}
            >
              <PhoneOff size={16} aria-hidden="true" />
              {copy.hangUp}
            </button>
          </div>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        className="flex min-h-0 grow scrollbar-thin flex-col gap-3 overflow-y-auto p-4"
      >
        <span className="text-11 font-semibold tracking-[0.05em] text-app-muted uppercase">
          {copy.transcriptTitle}
        </span>
        {lines.length === 0 ? <p className="m-0 text-14 text-app-muted">{copy.empty}</p> : null}
        <ol aria-label={copy.transcriptLabel} className="m-0 flex list-none flex-col gap-3 p-0">
          {lines.map((item) =>
            item.side === 'system' ? (
              <li key={item.key} className="flex items-center gap-2 text-13 text-app-muted">
                <span className="font-mono text-12">{item.time}</span>
                {item.text}
              </li>
            ) : (
              <li key={item.key} className="flex items-baseline gap-2.5">
                <span className="shrink-0 font-mono text-12 text-app-muted" aria-hidden="true">
                  {item.time}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      'text-13 font-semibold',
                      item.side === 'me' ? 'text-app-brand' : 'text-app-ink',
                    )}
                  >
                    {item.who}
                  </span>
                  <span className="text-15 leading-[1.45] break-words">{item.text}</span>
                </span>
              </li>
            ),
          )}
        </ol>
      </div>

      {failure ? (
        <div className="flex flex-col gap-2 bg-white px-5 pt-3">
          <p role="alert" className="m-0 text-13 text-danger">
            {describeCustomerCallFailure(failure, language)}
          </p>
          {isAssistantActive(failure) ? (
            <AskPersonButton customerId={customerId} language={language} />
          ) : null}
        </div>
      ) : null}
      {phase === 'live' || phase === 'hold' ? (
        <form
          onSubmit={say}
          className="flex flex-col gap-1.5 border-t border-app-line bg-white px-4 pt-3 pb-5"
        >
          <label htmlFor="call-say" className="text-13 font-semibold">
            {copy.sayLabel}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="call-say"
              type="text"
              autoComplete="off"
              placeholder={muted ? copy.mutedPlaceholder : copy.sayPlaceholder}
              value={text}
              disabled={muted || !talking}
              onChange={(event) => {
                setText(event.target.value)
                setLineKey(null)
              }}
              className="min-h-11 grow rounded-full border-0 bg-app-canvas px-4 text-15 text-app-ink placeholder:text-app-muted disabled:opacity-60"
            />
            <button
              type="submit"
              aria-disabled={!canSay || undefined}
              className={cn(pill, 'border-0 bg-app-brand text-white hover:bg-app-brand-strong')}
            >
              {copy.send}
            </button>
          </div>
        </form>
      ) : null}
      {!loading && (phase === 'ended' || phase === 'none') ? (
        <div className="flex flex-col gap-3 border-t border-app-line bg-white px-4 pt-3 pb-5">
          <ConversationSurvey
            customerId={customerId}
            conversation={chat.data?.conversation ?? null}
            language={language}
            skipped={skipped}
            onSkip={skip}
          />
          <button
            type="button"
            aria-busy={start.isPending || undefined}
            onClick={() => {
              if (!start.isPending) start.mutate({ key: crypto.randomUUID() })
            }}
            className={cn(pill, 'border-0 bg-app-brand text-white hover:bg-app-brand-strong')}
          >
            <Phone size={16} aria-hidden="true" />
            {copy.callAgain}
          </button>
        </div>
      ) : null}
      {callQuery.isError ? (
        <Callout tone="danger" title={copy.loadErrorTitle}>
          {copy.loadErrorBody}
        </Callout>
      ) : null}
    </section>
  )
}
