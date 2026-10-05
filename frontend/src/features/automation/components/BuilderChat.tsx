import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Bot, RotateCcw } from 'lucide-react'
import { automationProposalPath } from '@/app/paths'
import {
  Button,
  Callout,
  ComposerFrame,
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
import { chatEntries, type ChatEntry } from '../builder-chat'
import { useAskBuilder, useBuilderChat, useRestartBuilderChat } from '../hooks/use-automation'
import { proposalStatus } from '../proposals'
import type { BuilderThread, MaturingType, ProposalSummary } from '../types'

export interface BuilderChatSheetProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** A first message in the composer ("Proponer un agente"); she can edit it. */
  prefill?: string
  /** The case type the conversation is about: the proposal links carry it. */
  type?: MaturingType | null
}

/**
 * "Constructor de agentes" (slice 16's chat with `constructor-chat`): she says what she wants, it
 * drafts a proposal. One message at a time; a failed one keeps its id for "Reintentar". The thread
 * stays between visits; "Nueva conversación" starts over (an agent-core run can end).
 */
export function BuilderChatSheet({
  open,
  onOpenChange,
  prefill = '',
  type = null,
}: BuilderChatSheetProps) {
  const { t } = useTranslation('automation')
  const thread = useBuilderChat(open)
  const ask = useAskBuilder()
  const restart = useRestartBuilderChat()
  const { toast } = useToast()
  const [draft, setDraft] = useState(prefill)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const formId = useId()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || ask.sending) return
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
      initialFocusRef={inputRef}
      footer={
        <form id={formId} onSubmit={submit} className="flex w-full flex-col gap-2">
          <ComposerFrame>
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
              aria-disabled={ask.sending || draft.trim() === ''}
            >
              {t('chat.send')}
            </Button>
          </div>
        </form>
      }
    >
      <QueryState
        query={thread}
        skeleton={<Skeleton className="h-24 w-full" />}
        errorTitle={t('chat.loadError')}
      >
        {(data: BuilderThread) => (
          <ChatLog
            entries={chatEntries(data, ask.pending)}
            sending={ask.sending}
            onRetry={ask.retry}
            proposals={ask.proposals}
            type={type}
          />
        )}
      </QueryState>
    </Sheet>
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
