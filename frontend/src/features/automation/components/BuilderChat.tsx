import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Bot, RotateCcw } from 'lucide-react'
import { automationProposalPath } from '@/app/paths'
import {
  Button,
  Callout,
  ComposerFrame,
  Field,
  Input,
  LinkButton,
  QueryState,
  Sheet,
  Skeleton,
  Spinner,
  Status,
  Textarea,
  useToast,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useTranslation } from '@/lib/i18n'
import {
  MAX_GOAL,
  chatEntries,
  goalLength,
  isValidAgentId,
  type AgentRequest,
  type ChatEntry,
} from '../builder-chat'
import {
  useAskBuilder,
  useBuilderChat,
  useProposeAgent,
  useRestartBuilderChat,
} from '../hooks/use-automation'
import { proposalStatus } from '../proposals'
import type { BuilderThread, MaturingType, ProposalSummary } from '../types'

export interface BuilderChatSheetProps {
  open: boolean
  onOpenChange(open: boolean): void
  /**
   * "Proponer un agente": the agent id and the goal to answer the builder's two questions with,
   * in that order. She can edit both before sending.
   */
  request?: AgentRequest | null
  /** The case type the conversation is about: the proposal links carry it. */
  type?: MaturingType | null
  /**
   * Start a new conversation before the first message ("Proponer un agente"): the sheet restarts
   * her thread as it opens and never shows or continues the older one.
   */
  fresh?: boolean
}

/**
 * "Constructor de agentes" (slice 16's chat with `constructor-chat`): she says what she wants, it
 * drafts a proposal. One message at a time; a failed one keeps its id for "Reintentar". The thread
 * stays between visits; "Nueva conversación" starts over (an agent-core run can end), and so does
 * an opening with `fresh`. With a `request` ("Proponer un agente") the footer is a short form:
 * sending it answers the builder's questions one by one (the agent, then the goal), and she sees
 * each answer as it comes.
 */
export function BuilderChatSheet({
  open,
  onOpenChange,
  request = null,
  type = null,
  fresh = false,
}: BuilderChatSheetProps) {
  const { t } = useTranslation('automation')
  // While a fresh opening has not restarted the thread, the older one is neither read nor shown.
  const [needsRestart, setNeedsRestart] = useState(fresh)
  const thread = useBuilderChat(open && !needsRestart)
  const ask = useAskBuilder()
  const restart = useRestartBuilderChat()
  const { mutate: restartThread } = restart
  const { toast } = useToast()
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const formId = useId()
  const restarted = useRef(false)
  const propose = useProposeAgent(ask)
  // The request form shows until it is sent; then the composer takes over.
  const [pendingRequest, setPendingRequest] = useState<AgentRequest | null>(request)
  const [stopped, setStopped] = useState(false)

  async function sendRequest(answers: AgentRequest) {
    if (needsRestart) {
      // The restart on opening failed: try again, and only then answer the builder.
      try {
        await restart.mutateAsync()
      } catch {
        return
      }
      setNeedsRestart(false)
    }
    setPendingRequest(null)
    const outcome = await propose.run(answers)
    if (outcome !== 'done') {
      // The builder did not ask for the goal (or a message failed): she sends it when it fits.
      setDraft(answers.goal)
      setStopped(outcome === 'stopped')
    }
  }

  useEffect(() => {
    if (!open || !fresh || restarted.current) return
    restarted.current = true
    restartThread(undefined, { onSuccess: () => setNeedsRestart(false) })
  }, [open, fresh, restartThread])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || ask.sending || restart.isPending) return
    if (needsRestart) {
      // The restart on opening failed: try again, and only then send.
      restartThread(undefined, {
        onSuccess: () => {
          setNeedsRestart(false)
          ask.send(text)
          setDraft('')
        },
      })
      return
    }
    ask.send(text)
    setDraft('')
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('chat.title')}
      description={t('chat.description')}
      width={480}
      initialFocusRef={pendingRequest ? undefined : inputRef}
      footer={
        pendingRequest ? (
          <RequestForm
            initial={pendingRequest}
            disabled={restart.isPending || ask.sending || propose.running}
            onSubmit={(answers) => void sendRequest(answers)}
          />
        ) : (
          <form id={formId} onSubmit={submit} className="flex w-full flex-col gap-2">
            <ComposerFrame className="px-3 py-2.5">
              <Textarea
                ref={inputRef}
                variant="bare"
                aria-label={t('chat.message')}
                value={draft}
                rows={3}
                maxLength={2000}
                onChange={(event) => setDraft(event.target.value)}
              />
            </ComposerFrame>
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={16} />}
                loading={restart.isPending}
                disabled={ask.sending}
                onClick={() =>
                  restart.mutate(undefined, {
                    onSuccess: () => {
                      ask.clear()
                      toast({ title: t('chat.restartDone') })
                    },
                  })
                }
              >
                {t('chat.restart')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                aria-disabled={ask.sending || restart.isPending || draft.trim() === ''}
              >
                {t('chat.send')}
              </Button>
            </div>
          </form>
        )
      }
    >
      {needsRestart ? (
        restart.isError ? (
          <Callout tone="danger" title={t('chat.restartFailed')}>
            {t('chat.restartRetry')}
          </Callout>
        ) : (
          <Skeleton className="h-24 w-full" />
        )
      ) : (
        <QueryState
          query={thread}
          skeleton={<Skeleton className="h-24 w-full" />}
          errorTitle={t('chat.loadError')}
        >
          {(data: BuilderThread) => (
            <>
              <ChatLog
                entries={chatEntries(data, ask.pending)}
                sending={ask.sending || propose.running}
                onRetry={ask.retry}
                proposals={ask.proposals}
                type={type}
              />
              {stopped ? (
                <Callout tone="neutral" className="mt-3">
                  {t('chat.request.stopped')}
                </Callout>
              ) : null}
            </>
          )}
        </QueryState>
      )}
    </Sheet>
  )
}

interface RequestFormProps {
  initial: AgentRequest
  disabled: boolean
  onSubmit(request: AgentRequest): void
}

/**
 * "Pedido para el constructor": the agent id (agent-core's rule) and the goal (at most 200
 * characters: it becomes the proposal's title), prefilled for the type; she can edit both.
 */
function RequestForm({ initial, disabled, onSubmit }: RequestFormProps) {
  const { t } = useTranslation('automation')
  const [agentId, setAgentId] = useState(initial.agentId)
  const [goal, setGoal] = useState(initial.goal)
  const [touched, setTouched] = useState(false)
  const id = agentId.trim()
  const length = goalLength(goal.trim())
  const agentError = touched && !isValidAgentId(id) ? t('chat.request.agentInvalid') : undefined
  const goalError = !touched
    ? undefined
    : length === 0
      ? t('chat.request.goalEmpty')
      : length > MAX_GOAL
        ? t('chat.request.goalTooLong', { max: MAX_GOAL })
        : undefined
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTouched(true)
    if (disabled || !isValidAgentId(id) || length === 0 || length > MAX_GOAL) return
    onSubmit({ agentId: id, goal: goal.trim() })
  }
  return (
    <form
      onSubmit={submit}
      aria-label={t('chat.request.title')}
      className="flex w-full flex-col gap-3"
    >
      <p className="m-0 text-13 text-ink-2">{t('chat.request.intro')}</p>
      <Field label={t('chat.request.agent')} hint={t('chat.request.agentHint')} error={agentError}>
        <Input
          value={agentId}
          size="sm"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setAgentId(event.target.value)}
        />
      </Field>
      <Field
        label={t('chat.request.goal')}
        hint={t('chat.request.goalHint')}
        error={goalError}
        labelAside={
          <span className={cn('text-12', length > MAX_GOAL ? 'text-danger' : 'text-muted')}>
            {t('chat.request.goalCount', { count: length, max: MAX_GOAL })}
          </span>
        }
      >
        <Textarea value={goal} rows={4} onChange={(event) => setGoal(event.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" aria-disabled={disabled}>
          {t('chat.request.submit')}
        </Button>
      </div>
    </form>
  )
}

interface ChatLogProps {
  entries: ChatEntry[]
  sending: boolean
  onRetry(): void
  proposals: ProposalSummary[]
  type: MaturingType | null
}

function ChatLog({ entries, sending, onRetry, proposals, type }: ChatLogProps) {
  const { t } = useTranslation('automation')
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [entries.length, proposals.length])
  return (
    <div className="flex flex-col gap-3">
      {entries.length === 0 ? <p className="m-0 text-14 text-ink-2">{t('chat.empty')}</p> : null}
      <ol aria-label={t('chat.log')} className="m-0 flex list-none flex-col gap-3 p-0">
        {entries.map((entry) => (
          <li key={entry.key}>
            {entry.kind === 'message' ? (
              <Bubble agent={entry.message.role === 'agent'} text={entry.message.text} />
            ) : (
              <div className="flex flex-col items-end gap-1">
                <Bubble agent={false} text={entry.pending.text} muted />
                {entry.pending.status === 'failed' ? (
                  <span className="inline-flex items-center gap-2 text-13 text-danger">
                    {entry.pending.failure ?? t('chat.failed')}
                    <Button variant="ghost" size="sm" onClick={onRetry} disabled={sending}>
                      {t('chat.retry')}
                    </Button>
                  </span>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ol>
      {sending ? (
        <output className="inline-flex items-center gap-2 text-13 text-ink-2">
          <Spinner size={14} label={null} />
          {t('chat.thinking')}
        </output>
      ) : null}
      {proposals.length > 0 ? (
        <section aria-label={t('chat.proposalReady')} className="flex flex-col gap-2">
          {proposals.map((proposal) => (
            <Callout
              key={proposal.proposalId}
              tone="info"
              icon={false}
              title={proposal.title}
              actions={
                <LinkButton
                  to={automationProposalPath(proposal.proposalId, { type })}
                  variant="primary"
                  size="sm"
                >
                  {t('chat.openProposal')}
                </LinkButton>
              }
            >
              <Status {...proposalStatus(proposal.state)} size="sm" />
            </Callout>
          ))}
        </section>
      ) : null}
      <div ref={endRef} />
    </div>
  )
}

function Bubble({ agent, text, muted = false }: { agent: boolean; text: string; muted?: boolean }) {
  const { t } = useTranslation('automation')
  return (
    <div className={cn('flex flex-col gap-1', agent ? 'items-start' : 'items-end')}>
      <span className="inline-flex items-center gap-1 text-12 font-semibold text-muted">
        {agent ? <Bot size={13} aria-hidden="true" /> : null}
        {agent ? t('chat.builder') : t('chat.you')}
      </span>
      <p
        className={cn(
          'm-0 max-w-[88%] rounded-12 px-3 py-2 text-14 whitespace-pre-wrap',
          agent ? 'border border-accent-border bg-assistant-bubble' : 'bg-subtle',
          muted && 'opacity-70',
        )}
      >
        {text}
      </p>
    </div>
  )
}
