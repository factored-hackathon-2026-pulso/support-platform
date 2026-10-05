import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { CircleAlert, Eye, RefreshCcw, Send, Sparkles } from 'lucide-react'
import { Button, IconButton, Spinner, Textarea } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import { useTranslation } from '@/lib/i18n'
import {
  copilotNotice,
  copilotTurns,
  emptyThreadTitle,
  isAsking,
  normalizeQuestion,
  questionCounter,
  starterQuestions,
  MAX_QUESTION_LENGTH,
  type CopilotTurnView,
} from '../model'
import { useAskCopilot, useCopilotAsks, useCopilotThread } from '../hooks/use-copilot'

export interface CopilotPanelProps {
  caseId: string
  /** The customer's name: the quiet notice and the empty state say her first name. */
  customerName: string
  /** A closed case keeps its thread readable; the copilot no longer answers. */
  closed: boolean
}

/**
 * The "Copiloto" tab (slice 20, IaWorkspace "et1"): her thread with the copilot about this case.
 * A quiet line says it only reads; the empty thread offers starter questions that only fill the
 * box; a question waits 5-10 s with the box disabled ("Buscando la respuesta"), may get several
 * answers, and a failed one offers "Reintentar" (the same `clientMessageId`). Shown only while
 * `GET …/copilot` says `available` (the Workspace decides the tab).
 */
export function CopilotPanel({ caseId, customerName, closed }: CopilotPanelProps) {
  const { t } = useTranslation('copilot')
  const thread = useCopilotThread(caseId, true)
  const asks = useCopilotAsks(caseId)
  const { ask, retry } = useAskCopilot(caseId)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const hintId = `${id}-hint`

  const turns = copilotTurns(thread.data?.messages ?? [], asks)
  const asking = isAsking(asks)
  const question = normalizeQuestion(draft)
  const tooLong = draft.trim().length > MAX_QUESTION_LENGTH
  const blocked = closed || asking

  // The newest exchange stays in view (a question asked, an answer arrived).
  const lastKey = turns.at(-1)?.key ?? ''
  const lastState = turns.at(-1)?.state ?? ''
  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [lastKey, lastState, turns.length])

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (blocked || !question) return
    ask(question)
    setDraft('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  function pickStarter(text: string) {
    setDraft(text)
    inputRef.current?.focus()
  }

  return (
    <div className="flex min-h-0 grow flex-col">
      <p className="m-0 flex shrink-0 items-start gap-2 bg-subtle px-5 py-2.5 text-12 text-ink-2">
        <Eye size={14} aria-hidden="true" className="mt-px shrink-0 text-muted" />
        <span>{copilotNotice(customerName)}</span>
      </p>
      <div
        ref={scrollRef}
        className="flex min-h-0 grow scrollbar-thin flex-col gap-3 overflow-y-auto px-5 py-4"
      >
        {turns.length === 0 ? (
          <div className="flex flex-col gap-2 py-2">
            <h3 className="m-0 inline-flex items-center gap-2 text-15 font-semibold text-ink">
              <Sparkles size={16} aria-hidden="true" className="text-accent-strong" />
              {emptyThreadTitle(customerName)}
            </h3>
            <p className="m-0 text-13 text-ink-2">{t('thread.emptyText')}</p>
            {closed ? null : (
              <div className="mt-2 flex flex-col gap-1.5">
                <span className="text-11 font-semibold tracking-[0.05em] text-muted uppercase">
                  {t('thread.examples')}
                </span>
                {starterQuestions().map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => pickStarter(text)}
                    className="cursor-pointer rounded-10 border border-border bg-surface px-3 py-2 text-left text-13 text-ink hover:bg-subtle"
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <ol aria-label={t('thread.listLabel')} className="m-0 flex list-none flex-col gap-3 p-0">
            {turns.map((turn) => (
              <CopilotTurn
                key={turn.key}
                turn={turn}
                onRetry={retry}
                onAskAgain={ask}
                canAsk={!blocked}
              />
            ))}
          </ol>
        )}
        {/* Mounted with the tab, so "Buscando la respuesta" is announced. */}
        <output className={cn('block text-13 text-ink-2', !asking && 'sr-only')}>
          {asking ? (
            <span className="inline-flex items-center gap-2">
              <Spinner size={14} label={null} />
              {t('thread.asking')}
            </span>
          ) : null}
        </output>
      </div>
      <form
        onSubmit={submit}
        className="flex shrink-0 flex-col gap-1.5 border-t border-border-soft px-5 pt-3 pb-4"
      >
        <label htmlFor={id} className="sr-only">
          {t('box.label')}
        </label>
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            id={id}
            rows={2}
            value={draft}
            // Read-only, not disabled, while it answers: the focus stays in the box.
            readOnly={blocked}
            aria-disabled={blocked || undefined}
            placeholder={closed ? t('box.placeholderClosed') : t('box.placeholder')}
            aria-describedby={hintId}
            aria-invalid={tooLong || undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className={cn('min-w-0 grow resize-none text-14', blocked && 'bg-subtle text-muted')}
          />
          <IconButton
            type="submit"
            variant="primary"
            aria-label={t('box.submit')}
            aria-disabled={blocked || !question || undefined}
            icon={<Send size={16} aria-hidden="true" />}
          />
        </div>
        <span
          id={hintId}
          className={cn(
            'flex justify-between gap-2 text-12',
            tooLong ? 'text-danger-strong' : 'text-muted',
          )}
        >
          <span>
            {closed ? t('box.hintClosed') : tooLong ? t('box.hintTooLong') : t('box.hint')}
          </span>
          <span aria-hidden="true">{questionCounter(draft)}</span>
        </span>
      </form>
    </div>
  )
}

interface CopilotTurnProps {
  turn: CopilotTurnView
  onRetry(clientMessageId: string): void
  onAskAgain(text: string): void
  canAsk: boolean
}

function CopilotTurn({ turn, onRetry, onAskAgain, canAsk }: CopilotTurnProps) {
  const { t } = useTranslation(['copilot', 'common'])
  return (
    <li className="flex flex-col gap-2">
      <div className="flex flex-col items-end gap-1">
        <p className="m-0 max-w-[90%] rounded-12 bg-panel px-3 py-2 text-14 whitespace-pre-wrap text-ink">
          <span className="sr-only">{t('thread.you')} </span>
          {turn.text}
        </p>
        {turn.state === 'failed' ? (
          <span
            role="alert"
            className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-12 text-danger-strong"
          >
            <CircleAlert size={13} aria-hidden="true" />
            {turn.error ?? t('thread.failed')}
            {turn.retryable && turn.clientMessageId ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCcw size={13} aria-hidden="true" />}
                onClick={() => onRetry(turn.clientMessageId!)}
                disabled={!canAsk}
              >
                {t('common:actions.retry')}
              </Button>
            ) : null}
          </span>
        ) : turn.state === 'unanswered' ? (
          <span className="inline-flex items-center gap-2 text-12 text-muted">
            {t('thread.unanswered')}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAskAgain(turn.text)}
              disabled={!canAsk}
            >
              {t('thread.askAgain')}
            </Button>
          </span>
        ) : turn.state === 'answered' ? (
          <span aria-hidden="true" className="text-11 text-muted">
            {formatTime(turn.createdAt)}
          </span>
        ) : null}
      </div>
      {turn.answers.map((answer) => (
        <p key={answer.id} className="m-0 text-14 leading-[1.45] whitespace-pre-wrap text-ink">
          <span className="sr-only">{t('thread.copilot')} </span>
          {answer.text}
        </p>
      ))}
    </li>
  )
}
